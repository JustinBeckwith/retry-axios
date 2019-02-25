import * as assert from 'assert';
import axios from 'axios';
import * as nock from 'nock';
import * as rax from '../src';
import {RaxConfig} from '../src';

const url = 'http://test.local';

nock.disableNetConnect();

describe('retry-axios', () => {
  let interceptorId: number|undefined;
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
      assert.equal(config!.currentRetryAttempt, 3, 'currentRetryAttempt');
      assert.equal(config!.retry, 3, 'retry');
      assert.equal(config!.noResponseRetries, 2, 'noResponseRetries');
      assert.equal(config!.retryDelay, 100, 'retryDelay');
      assert.equal(config!.instance, axios, 'axios');
      const expectedMethods = ['GET', 'HEAD', 'PUT', 'OPTIONS', 'DELETE'];
      for (const method of config!.httpMethodsToRetry!) {
        assert(expectedMethods.indexOf(method) > -1, `exected method: $method`);
      }
      const expectedStatusCodes = [[100, 199], [429, 429], [500, 599]];
      const statusCodesToRetry = config!.statusCodesToRetry!;
      for (let i = 0; i < statusCodesToRetry.length; i++) {
        const [min, max] = statusCodesToRetry[i];
        const [expMin, expMax] = expectedStatusCodes[i];
        assert.equal(min, expMin, `status code min`);
        assert.equal(max, expMax, `status code max`);
      }
      return;
    }
    assert.fail('Expected to throw.');
  });

  it('should retry on 500 on the main export', async () => {
    const scopes =
        [nock(url).get('/').reply(500), nock(url).get('/').reply(200, 'toast')];
    interceptorId = rax.attach();
    const res = await axios({url});
    assert.equal(res.data, 'toast');
    scopes.forEach(s => s.done());
  });

  it('should not retry on a post', async () => {
    const scope = nock(url).post('/').reply(500);
    interceptorId = rax.attach();
    try {
      await axios.post(url);
    } catch (e) {
      const config = rax.getConfig(e);
      assert.equal(config!.currentRetryAttempt, 0);
      scope.done();
      return;
    }
    assert.fail('Expected to throw');
  });

  it('should retry at least the configured number of times', async () => {
    const scopes = [
      nock(url).get('/').times(3).reply(500),
      nock(url).get('/').reply(200, 'milk')
    ];
    interceptorId = rax.attach();
    const cfg: rax.RaxConfig = {url, raxConfig: {retry: 4}};
    const res = await axios(cfg);
    assert.equal(res.data, 'milk');
    scopes.forEach(s => s.done());
  }).timeout(10000);

  it('should not retry more than configured', async () => {
    const scope = nock(url).get('/').twice().reply(500);
    interceptorId = rax.attach();
    const cfg: rax.RaxConfig = {url, raxConfig: {retry: 1}};
    try {
      await axios(cfg);
    } catch (e) {
      assert.equal(rax.getConfig(e)!.currentRetryAttempt, 1);
      scope.done();
      return;
    }
    assert.fail('Expected to throw');
  });

  it('should accept a new axios instance', async () => {
    const scopes = [
      nock(url).get('/').times(2).reply(500),
      nock(url).get('/').reply(200, 'raisins')
    ];
    const ax = axios.create();
    interceptorId = rax.attach(ax);
    const cfg = {raxConfig: {instance: ax}} as RaxConfig;
    const res = await ax.get(url, cfg);
    assert.equal(res.data, 'raisins');
    scopes.forEach(s => s.done());

    // now make sure it fails the first time with just `axios`
    const scope = nock(url).get('/').reply(500);
    assert.notEqual(ax, axios);
    try {
      await axios({url});
    } catch (e) {
      assert.equal(undefined, rax.getConfig(e));
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
      assert.equal(cfg!.currentRetryAttempt, 0);
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
      assert.equal(0, cfg!.currentRetryAttempt);
      scope.done();
      return;
    }
    assert.fail('Expected to throw');
  });

  it('should notify on retry attempts', async () => {
    const scopes =
        [nock(url).get('/').reply(500), nock(url).get('/').reply(200, 'toast')];
    interceptorId = rax.attach();
    let flipped = false;
    const config: RaxConfig = {
      url,
      raxConfig: {
        onRetryAttempt: (err) => {
          const cfg = rax.getConfig(err);
          assert.equal(cfg!.currentRetryAttempt, 1);
          flipped = true;
        }
      }
    };
    const res = await axios(config);
    assert.equal(flipped, true);
    scopes.forEach(s => s.done());
  });

  it('should notify on retry attempts as a promise', async () => {
    const scopes =
        [nock(url).get('/').reply(500), nock(url).get('/').reply(200, 'toast')];
    interceptorId = rax.attach();
    let flipped = false;
    const config: RaxConfig = {
      url,
      raxConfig: {
        onRetryAttempt: (err) => {
          return new Promise((resolve, reject) => {
            const cfg = rax.getConfig(err);
            assert.equal(cfg!.currentRetryAttempt, 1);
            flipped = true;
            resolve();
          });
        }
      }
    };
    const res = await axios(config);
    assert.equal(flipped, true);
    scopes.forEach(s => s.done());
  });

  it('should support overriding the shouldRetry method', async () => {
    const scope = nock(url).get('/').reply(500);
    interceptorId = rax.attach();
    const config: RaxConfig = {
      url,
      raxConfig: {
        shouldRetry: (err) => {
          const cfg = rax.getConfig(err);
          return false;
        }
      }
    };
    try {
      await axios(config);
    } catch (e) {
      const cfg = rax.getConfig(e);
      assert.equal(cfg!.currentRetryAttempt, 0);
      scope.done();
      return;
    }
    assert.fail('Expected to throw');
  });

  it('should retry on ENOTFOUND', async () => {
    const scopes = [
      nock(url).get('/').replyWithError({code: 'ENOTFOUND'}),
      nock(url).get('/').reply(200, 'oatmeal')
    ];
    interceptorId = rax.attach();
    const res = await axios.get(url);
    assert.equal(res.data, 'oatmeal');
    scopes.forEach(s => s.done());
  });

  it('should retry on ETIMEDOUT', async () => {
    const scopes = [
      nock(url).get('/').replyWithError({code: 'ETIMEDOUT'}),
      nock(url).get('/').reply(200, 'bacon')
    ];
    interceptorId = rax.attach();
    const res = await axios.get(url);
    assert.equal(res.data, 'bacon');
    scopes.forEach(s => s.done());
  });

  it('should allow configuring noResponseRetries', async () => {
    const scope = nock(url).get('/').replyWithError({code: 'ETIMEDOUT'});
    interceptorId = rax.attach();
    const config = {url, raxConfig: {noResponseRetries: 0}};
    try {
      const res = await axios(config);
    } catch (e) {
      const cfg = rax.getConfig(e);
      assert.equal(cfg!.currentRetryAttempt, 0);
      scope.isDone();
      return;
    }
    assert.fail('Expected to throw');
  });
});