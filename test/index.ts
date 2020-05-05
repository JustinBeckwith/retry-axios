import * as assert from 'assert';
import axios, {AxiosRequestConfig} from 'axios';
import * as nock from 'nock';
import {describe, it, afterEach} from 'mocha';
import * as rax from '../src';
import {RaxConfig} from '../src';

const url = 'http://test.local';

nock.disableNetConnect();

describe('retry-axios', () => {
  let interceptorId: number | undefined;
  afterEach(() => {
    nock.cleanAll();
    if (interceptorId !== undefined) {
      rax.detach(interceptorId);
    }
  });

  it('should provide an expected set of defaults', async () => {
    const scope = nock(url).get('/').thrice().reply(500);
    interceptorId = rax.attach();
    try {
      await axios(url);
    } catch (e) {
      scope.done();
      const config = rax.getConfig(e);
      assert.strictEqual(config!.currentRetryAttempt, 3, 'currentRetryAttempt');
      assert.strictEqual(config!.retry, 3, 'retry');
      assert.strictEqual(config!.noResponseRetries, 2, 'noResponseRetries');
      assert.strictEqual(config!.retryDelay, 100, 'retryDelay');
      assert.strictEqual(config!.instance, axios, 'axios');
      assert.strictEqual(config!.backoffType, 'exponential', 'backoffType');
      const expectedMethods = ['GET', 'HEAD', 'PUT', 'OPTIONS', 'DELETE'];
      for (const method of config!.httpMethodsToRetry!) {
        assert(expectedMethods.indexOf(method) > -1, 'exected method: $method');
      }
      const expectedStatusCodes = [
        [100, 199],
        [429, 429],
        [500, 599],
      ];
      const statusCodesToRetry = config!.statusCodesToRetry!;
      for (let i = 0; i < statusCodesToRetry.length; i++) {
        const [min, max] = statusCodesToRetry[i];
        const [expMin, expMax] = expectedStatusCodes[i];
        assert.strictEqual(min, expMin, 'status code min');
        assert.strictEqual(max, expMax, 'status code max');
      }
      return;
    }
    assert.fail('Expected to throw.');
  });

  it('should retry on 500 on the main export', async () => {
    const scopes = [
      nock(url).get('/').reply(500),
      nock(url).get('/').reply(200, 'toast'),
    ];
    interceptorId = rax.attach();
    const res = await axios({url});
    assert.strictEqual(res.data, 'toast');
    scopes.forEach(s => s.done());
  });

  it('should not retry on a post', async () => {
    const scope = nock(url).post('/').reply(500);
    interceptorId = rax.attach();
    try {
      await axios.post(url);
    } catch (e) {
      const config = rax.getConfig(e);
      assert.strictEqual(config!.currentRetryAttempt, 0);
      scope.done();
      return;
    }
    assert.fail('Expected to throw');
  });

  it('should retry at least the configured number of times', async () => {
    const scopes = [
      nock(url).get('/').times(3).reply(500),
      nock(url).get('/').reply(200, 'milk'),
    ];
    interceptorId = rax.attach();
    const cfg: rax.RaxConfig = {url, raxConfig: {retry: 4}};
    const res = await axios(cfg);
    assert.strictEqual(res.data, 'milk');
    scopes.forEach(s => s.done());
  }).timeout(10000);

  it('should not retry more than configured', async () => {
    const scope = nock(url).get('/').twice().reply(500);
    interceptorId = rax.attach();
    const cfg: rax.RaxConfig = {url, raxConfig: {retry: 1}};
    try {
      await axios(cfg);
    } catch (e) {
      assert.strictEqual(rax.getConfig(e)!.currentRetryAttempt, 1);
      scope.done();
      return;
    }
    assert.fail('Expected to throw');
  });

  it('should accept a new axios instance', async () => {
    const scopes = [
      nock(url).get('/').times(2).reply(500),
      nock(url).get('/').reply(200, 'raisins'),
    ];
    const ax = axios.create();
    interceptorId = rax.attach(ax);
    const cfg = {raxConfig: {instance: ax}} as RaxConfig;
    const res = await ax.get(url, cfg);
    assert.strictEqual(res.data, 'raisins');
    scopes.forEach(s => s.done());

    // now make sure it fails the first time with just `axios`
    const scope = nock(url).get('/').reply(500);
    assert.notStrictEqual(ax, axios);
    try {
      await axios({url});
    } catch (e) {
      assert.strictEqual(undefined, rax.getConfig(e));
      scope.done();
      return;
    }
    assert.fail('Expected to throw');
  });

  it('should not retry on 4xx errors', async () => {
    const scope = nock(url).get('/').reply(404);
    interceptorId = rax.attach();
    try {
      await axios.get(url);
    } catch (e) {
      const cfg = rax.getConfig(e);
      assert.strictEqual(cfg!.currentRetryAttempt, 0);
      scope.done();
      return;
    }
    assert.fail('Expected to throw');
  });

  it('should not retry if retries set to 0', async () => {
    const scope = nock(url).get('/').reply(500);
    interceptorId = rax.attach();
    try {
      const cfg: rax.RaxConfig = {url, raxConfig: {retry: 0}};
      await axios(cfg);
    } catch (e) {
      const cfg = rax.getConfig(e);
      assert.strictEqual(0, cfg!.currentRetryAttempt);
      scope.done();
      return;
    }
    assert.fail('Expected to throw');
  });

  it('should allow configuring backoffType', async () => {
    const scope = nock(url).get('/').replyWithError({code: 'ETIMEDOUT'});
    interceptorId = rax.attach();
    const config: AxiosRequestConfig = {
      url,
      raxConfig: {backoffType: 'exponential'},
    };
    try {
      await axios(config);
    } catch (e) {
      const cfg = rax.getConfig(e);
      assert.strictEqual(cfg!.backoffType, 'exponential');
      scope.isDone();
      return;
    }
    assert.fail('Expected to throw');
  });

  it('should notify on retry attempts', async () => {
    const scopes = [
      nock(url).get('/').reply(500),
      nock(url).get('/').reply(200, 'toast'),
    ];
    interceptorId = rax.attach();
    let flipped = false;
    const config: RaxConfig = {
      url,
      raxConfig: {
        onRetryAttempt: err => {
          const cfg = rax.getConfig(err);
          assert.strictEqual(cfg!.currentRetryAttempt, 1);
          flipped = true;
        },
      },
    };
    await axios(config);
    assert.strictEqual(flipped, true);
    scopes.forEach(s => s.done());
  });

  it('should notify on retry attempts as a promise', async () => {
    const scopes = [
      nock(url).get('/').reply(500),
      nock(url).get('/').reply(200, 'toast'),
    ];
    interceptorId = rax.attach();
    let flipped = false;
    const config: RaxConfig = {
      url,
      raxConfig: {
        onRetryAttempt: err => {
          return new Promise(resolve => {
            const cfg = rax.getConfig(err);
            assert.strictEqual(cfg!.currentRetryAttempt, 1);
            flipped = true;
            resolve();
          });
        },
      },
    };
    await axios(config);
    assert.strictEqual(flipped, true);
    scopes.forEach(s => s.done());
  });

  it('should support overriding the shouldRetry method', async () => {
    const scope = nock(url).get('/').reply(500);
    interceptorId = rax.attach();
    const config: RaxConfig = {
      url,
      raxConfig: {
        shouldRetry: err => {
          rax.getConfig(err);
          return false;
        },
      },
    };
    try {
      await axios(config);
    } catch (e) {
      const cfg = rax.getConfig(e);
      assert.strictEqual(cfg!.currentRetryAttempt, 0);
      scope.done();
      return;
    }
    assert.fail('Expected to throw');
  });

  it('should retry on ENOTFOUND', async () => {
    const scopes = [
      nock(url).get('/').replyWithError({code: 'ENOTFOUND'}),
      nock(url).get('/').reply(200, 'oatmeal'),
    ];
    interceptorId = rax.attach();
    const res = await axios.get(url);
    assert.strictEqual(res.data, 'oatmeal');
    scopes.forEach(s => s.done());
  });

  it('should retry on ETIMEDOUT', async () => {
    const scopes = [
      nock(url).get('/').replyWithError({code: 'ETIMEDOUT'}),
      nock(url).get('/').reply(200, 'bacon'),
    ];
    interceptorId = rax.attach();
    const res = await axios.get(url);
    assert.strictEqual(res.data, 'bacon');
    scopes.forEach(s => s.done());
  });

  it('should allow configuring noResponseRetries', async () => {
    const scope = nock(url).get('/').replyWithError({code: 'ETIMEDOUT'});
    interceptorId = rax.attach();
    const config = {url, raxConfig: {noResponseRetries: 0}};
    try {
      await axios(config);
    } catch (e) {
      const cfg = rax.getConfig(e);
      assert.strictEqual(cfg!.currentRetryAttempt, 0);
      scope.isDone();
      return;
    }
    assert.fail('Expected to throw');
  });

  it('should reset error counter upon success', async () => {
    const scopes = [
      nock(url).get('/').times(2).reply(500),
      nock(url).get('/').reply(200, 'milk'),
      nock(url).get('/').reply(500),
      nock(url).get('/').reply(200, 'toast'),
    ];
    interceptorId = rax.attach();
    const cfg: rax.RaxConfig = {url, raxConfig: {retry: 2}};
    const res = await axios(cfg);
    assert.strictEqual(res.data, 'milk');
    const res2 = await axios(cfg);
    assert.strictEqual(res2.data, 'toast');
    scopes.forEach(s => s.done());
  });

  it('should ignore requests that have been canceled', async () => {
    const scopes = [
      nock(url)
        .get('/')
        .times(2)
        .delay(5)
        .reply(500),
      nock(url)
        .get('/')
        .reply(200, 'toast'),
    ];
    interceptorId = rax.attach();
    try {
      const src = axios.CancelToken.source();
      const cfg: rax.RaxConfig = {
        url,
        raxConfig: { retry: 2 },
        cancelToken: src.token,
      };
      const req = axios(cfg);
      setTimeout(() => {
        src.cancel();
      }, 10);
      const res = await req;
      throw new Error('The canceled request completed.');
    } catch (err) {
      assert.strictEqual(axios.isCancel(err), true);
    }
    assert.strictEqual(scopes[1].isDone(), false);
  });
});
