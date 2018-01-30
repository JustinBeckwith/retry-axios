import * as assert from 'assert';
import axios, {AxiosError} from 'axios';
import * as nock from 'nock';
import * as rax from '../src';
import {RaxConfig, RetryConfig} from '../src';

const url = 'http://test.local';

nock.disableNetConnect();

describe('retry-axios', () => {
  let interceptorId: number|null;

  afterEach(() => {
    nock.cleanAll();
    if (interceptorId) {
      rax.detach(interceptorId);
    }
  });

  it('should provide an expected set of defaults', async () => {
    nock(url).get('/').reply(500);
    interceptorId = rax.attach();
    try {
      await axios({url});
      assert.fail('Expected to throw.');
    } catch (e) {
      const config = rax.getConfig(e);
      assert.equal(config!.currentRetryAttempt, 3);
      assert.equal(config!.retry, 3);
      assert.equal(config!.retryDelay, 100);
      assert.equal(config!.instance, axios);
      const expectedMethods = ['GET', 'HEAD', 'PUT', 'OPTIONS', 'DELETE'];
      for (const method of config!.httpMethodsToRetry!) {
        assert(expectedMethods.indexOf(method) > -1);
      }
      const expectedStatusCodes = [[100, 199], [429, 429], [500, 599]];
      const statusCodesToRetry = config!.statusCodesToRetry!;
      for (let i = 0; i < statusCodesToRetry.length; i++) {
        const [min, max] = statusCodesToRetry[i];
        const [expMin, expMax] = expectedStatusCodes[i];
        assert.equal(min, expMin);
        assert.equal(max, expMax);
      }
    }
  });

  it('should retry on 500 on the main export', async () => {
    nock(url).get('/').reply(500);
    nock(url).get('/').reply(200, 'toast');
    interceptorId = rax.attach();
    const res = await axios({url});
    assert.equal(res.data, 'toast');
  });

  it('should not retry on a post', async () => {
    nock(url).post('/').reply(500);
    interceptorId = rax.attach();
    try {
      await axios.post(url);
      assert.fail('Expected to throw');
    } catch (e) {
      const config = rax.getConfig(e);
      assert.equal(config!.currentRetryAttempt, 0);
    }
  });

  it('should retry at least the configured number of times', async () => {
    nock(url).get('/').twice().reply(500);
    nock(url).get('/').reply(200, 'milk');
    interceptorId = rax.attach();
    const cfg: rax.RaxConfig = {url, raxConfig: {retry: 2}};
    const res = await axios(cfg);
    assert.equal(res.data, 'milk');
  });

  it('should not retry more than configured', async () => {
    nock(url).get('/').twice().reply(500);
    nock(url).get('/').reply(200, 'milk');
    interceptorId = rax.attach();
    const cfg: rax.RaxConfig = {url, raxConfig: {retry: 1}};
    try {
      await axios(cfg);
      assert.fail('Expected to throw');
    } catch (e) {
      assert.equal(rax.getConfig(e)!.currentRetryAttempt, 1);
    }
  });

  it('should accept a new axios instance', async () => {
    nock(url).get('/').reply(500);
    nock(url).get('/').reply(200, 'raisins');
    const ax = axios.create();
    interceptorId = rax.attach(ax);
    const res = await ax.get(url);
    assert.equal(res.data, 'raisins');

    // now make sure it fails the first time with just `axios`
    nock(url).get('/').reply(500);
    nock(url).get('/').reply(200, 'raisins');
    try {
      await axios({url});
      assert.fail('Expected to throw');
    } catch (e) {
      assert.equal(undefined, rax.getConfig(e));
    }
  });

  it('should not retry on 4xx errors', async () => {
    nock(url).get('/').reply(404);
    nock(url).get('/').reply(200);
    interceptorId = rax.attach();
    try {
      await axios.get(url);
      assert.fail('Expected to throw');
    } catch (e) {
      const cfg = rax.getConfig(e);
      assert.equal(cfg!.currentRetryAttempt, 0);
    }
  });

  it('should not retry if retries set to 0', async () => {
    nock(url).get('/').reply(500);
    interceptorId = rax.attach();
    try {
      const cfg: rax.RaxConfig = {url, raxConfig: {retry: 0}};
      await axios(cfg);
      assert.fail('Expected to throw');
    } catch (e) {
      const cfg = rax.getConfig(e);
      assert.equal(0, cfg!.currentRetryAttempt);
    }
  });

  it('should notify on retry attempts', async () => {
    nock(url).get('/').reply(500);
    nock(url).get('/').reply(200, 'toast');
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
  });

  it('should support overriding the shouldRetry method', async () => {
    nock(url).get('/').reply(500);
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
      assert.fail('Expected to throw');
    } catch (e) {
      const cfg = rax.getConfig(e);
      assert.equal(cfg!.currentRetryAttempt, 0);
    }
  });
});