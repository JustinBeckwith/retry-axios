import * as assert from 'assert';
import axios, {AxiosError, AxiosRequestConfig} from 'axios';
import * as nock from 'nock';
import * as sinon from 'sinon';
import {describe, it, afterEach} from 'mocha';
import * as rax from '../src';
import {RaxConfig} from '../src';

const url = 'http://test.local';

nock.disableNetConnect();

describe('retry-axios', () => {
  let interceptorId: number | undefined;
  afterEach(() => {
    sinon.restore();
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
      assert.strictEqual(config!.checkRetryAfter, true);
      assert.strictEqual(config!.maxRetryAfter, 60000 * 5);
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

  it('should retry at least the configured number of times', async function () {
    this.timeout(10000);
    const scopes = [
      nock(url).get('/').times(3).reply(500),
      nock(url).get('/').reply(200, 'milk'),
    ];
    interceptorId = rax.attach();
    const cfg: rax.RaxConfig = {url, raxConfig: {retry: 4}};
    const res = await axios(cfg);
    assert.strictEqual(res.data, 'milk');
    scopes.forEach(s => s.done());
  });

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

  it('should accept defaults on a new instance', async () => {
    const scopes = [
      nock(url).get('/').times(2).reply(500),
      nock(url).get('/').reply(200, '🥧'),
    ];
    const ax = axios.create();
    ax.defaults.raxConfig = {
      retry: 3,
      instance: ax,
      onRetryAttempt: evt => {
        console.log(`attempt #${evt.config!.raxConfig?.currentRetryAttempt}`);
      },
    };
    interceptorId = rax.attach(ax);
    const res = await ax.get(url);
    assert.strictEqual(res.data, '🥧');
    scopes.forEach(s => s.done());
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
            resolve(undefined);
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
      nock(url).get('/').times(2).delay(5).reply(500),
      nock(url).get('/').reply(200, 'toast'),
    ];
    interceptorId = rax.attach();
    try {
      const src = axios.CancelToken.source();
      const cfg: rax.RaxConfig = {
        url,
        raxConfig: {retry: 2},
        cancelToken: src.token,
      };
      const req = axios(cfg);
      setTimeout(() => {
        src.cancel();
      }, 10);
      await req;
      throw new Error('The canceled request completed.');
    } catch (err) {
      assert.strictEqual(axios.isCancel(err), true);
    }
    assert.strictEqual(scopes[1].isDone(), false);
  });

  it('should accept 0 for config.retryDelay', async () => {
    const scope = nock(url).get('/').replyWithError({code: 'ETIMEDOUT'});
    interceptorId = rax.attach();
    const config: AxiosRequestConfig = {
      url,
      raxConfig: {retryDelay: 0},
    };
    try {
      await axios(config);
    } catch (e) {
      const cfg = rax.getConfig(e);
      assert.strictEqual(cfg!.retryDelay, 0);
      scope.isDone();
      return;
    }
    assert.fail('Expected to throw');
  });

  it('should accept 0 for config.retry', async () => {
    const scope = nock(url).get('/').replyWithError({code: 'ETIMEDOUT'});
    interceptorId = rax.attach();
    const config: AxiosRequestConfig = {
      url,
      raxConfig: {retry: 0},
    };
    try {
      await axios(config);
    } catch (e) {
      const cfg = rax.getConfig(e);
      assert.strictEqual(cfg!.retry, 0);
      scope.isDone();
      return;
    }
    assert.fail('Expected to throw');
  });

  it('should accept 0 for config.noResponseRetries', async () => {
    const scope = nock(url).get('/').replyWithError({code: 'ETIMEDOUT'});
    interceptorId = rax.attach();
    const config: AxiosRequestConfig = {
      url,
      raxConfig: {noResponseRetries: 0},
    };
    try {
      await axios(config);
    } catch (e) {
      const cfg = rax.getConfig(e);
      assert.strictEqual(cfg!.noResponseRetries, 0);
      scope.isDone();
      return;
    }
    assert.fail('Expected to throw');
  });

  it('should retry with Retry-After header in seconds', async function () {
    this.timeout(1000); // Short timeout to trip test if delay longer than expected
    const scopes = [
      nock(url).get('/').reply(429, undefined, {
        'Retry-After': '5',
      }),
      nock(url).get('/').reply(200, 'toast'),
    ];
    interceptorId = rax.attach();
    const {promise, resolve} = invertedPromise();
    const clock = sinon.useFakeTimers({
      shouldAdvanceTime: true, // Otherwise interferes with nock
    });
    const axiosPromise = axios({
      url,
      raxConfig: {
        onRetryAttempt: resolve,
        retryDelay: 10000, // Higher default to ensure Retry-After is used
        backoffType: 'static',
      },
    });
    await promise;
    clock.tick(5000); // Advance clock by expected retry delay
    const res = await axiosPromise;
    assert.strictEqual(res.data, 'toast');
    scopes.forEach(s => s.done());
  });

  it('should retry with Retry-After header in http datetime', async function () {
    this.timeout(1000);
    const scopes = [
      nock(url).get('/').reply(429, undefined, {
        'Retry-After': 'Thu, 01 Jan 1970 00:00:05 UTC',
      }),
      nock(url).get('/').reply(200, 'toast'),
    ];
    interceptorId = rax.attach();
    const {promise, resolve} = invertedPromise();
    const clock = sinon.useFakeTimers({
      shouldAdvanceTime: true,
    });
    const axiosPromise = axios({
      url,
      raxConfig: {
        onRetryAttempt: resolve,
        backoffType: 'static',
        retryDelay: 10000,
      },
    });
    await promise;
    clock.tick(5000);
    const res = await axiosPromise;
    assert.strictEqual(res.data, 'toast');
    scopes.forEach(s => s.done());
  });

  it('should not retry if Retry-After greater than maxRetryAfter', async () => {
    const scopes = [
      nock(url).get('/').reply(429, undefined, {'Retry-After': '2'}),
      nock(url).get('/').reply(200, 'toast'),
    ];
    interceptorId = rax.attach();
    const cfg: rax.RaxConfig = {url, raxConfig: {maxRetryAfter: 1000}};
    await assert.rejects(axios(cfg));
    assert.strictEqual(scopes[1].isDone(), false);
  });

  it('should config.onFail() called if all retry failed', async () => {
    const scope = nock(url)
      .get('/')
      .times(2)
      .reply(500, {errorMessage: 'ErrorMessage'});
    /* eslint @typescript-eslint/no-unused-vars: 0 */
    const onFail = sinon.spy((_: AxiosError) => {});
    interceptorId = rax.attach();
    const cfg: rax.RaxConfig = {url, raxConfig: {retry: 1, onFail}};
    try {
      await axios(cfg);
    } catch (e) {
      sinon.assert.calledOnce(onFail);
      sinon.assert.calledOnceWithExactly(onFail, e);
    }

    scope.done();
  });

  it('should throw error in onFail() called if all retry failed when the network is unavailable', async () => {
    nock.disableNetConnect();
    /* eslint @typescript-eslint/no-unused-vars: 0 */
    const onFail = sinon.spy((_: AxiosError) => {});
    interceptorId = rax.attach();
    const cfg: rax.RaxConfig = {url, raxConfig: {onFail}};
    try {
      await axios(cfg);
    } catch (e) {
      sinon.assert.calledOnce(onFail);
      sinon.assert.calledOnceWithExactly(onFail, e);
    }
  });

  it('should throw the error by axios to the caller, if an error occurs in onFail()', async () => {
    const scope = nock(url)
      .get('/')
      .times(2)
      .reply(500, {errorMessage: 'ErrorMessage'});
    const errorThrownByOnFail = new Error('Error in onFail()');
    /* eslint @typescript-eslint/no-unused-vars: 0 */
    const onFail = sinon.spy((_: AxiosError) => {
      throw errorThrownByOnFail;
    });
    interceptorId = rax.attach();
    const cfg: rax.RaxConfig = {url, raxConfig: {retry: 1, onFail}};
    try {
      await axios(cfg);
    } catch (e) {
      sinon.assert.calledOnce(onFail);
      assert.notDeepStrictEqual(e, errorThrownByOnFail);
      assert.deepStrictEqual(e.response.data, {errorMessage: 'ErrorMessage'});
    }
    scope.done();
  });
});

function invertedPromise() {
  let resolve!: () => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<void>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return {promise, resolve, reject};
}
