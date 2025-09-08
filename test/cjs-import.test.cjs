const assert = require('node:assert');
const axios = require('axios');
const { describe, it, afterEach } = require('mocha');
const nock = require('nock');

// Test CommonJS import
const rax = require('../build/src/index.cjs');

const url = 'http://test-cjs.local';

nock.disableNetConnect();

describe('retry-axios CJS import', () => {
  let interceptorId;
  
  afterEach(() => {
    nock.cleanAll();
    if (interceptorId !== undefined) {
      rax.detach(interceptorId);
      interceptorId = undefined;
    }
  });

  it('should successfully import all exports via CommonJS', () => {
    assert.strictEqual(typeof rax.attach, 'function', 'attach should be a function');
    assert.strictEqual(typeof rax.detach, 'function', 'detach should be a function'); 
    assert.strictEqual(typeof rax.shouldRetryRequest, 'function', 'shouldRetryRequest should be a function');
    assert.strictEqual(typeof rax.getConfig, 'function', 'getConfig should be a function');
  });

  it('should work with basic retry functionality via CJS import', async () => {
    const scope = nock(url)
      .get('/')
      .reply(500)
      .get('/')
      .reply(200, 'success');
    
    interceptorId = rax.attach();
    
    const response = await axios.get(url, {
      raxConfig: {
        retry: 2,
        retryDelay: 10
      }
    });
    
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.data, 'success');
    scope.done();
  });

  it('should properly handle axios instance with CJS import', async () => {
    const customAxios = axios.create();
    const scope = nock(url)
      .get('/instance')
      .reply(500)
      .get('/instance')
      .reply(200, 'instance-success');
    
    interceptorId = rax.attach(customAxios);
    
    const response = await customAxios.get(url + '/instance', {
      raxConfig: {
        retry: 2,
        retryDelay: 10
      }
    });
    
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.data, 'instance-success');
    scope.done();
  });

  it('should provide access to configuration via CJS import', async () => {
    const scope = nock(url)
      .get('/config')
      .reply(500);
    
    interceptorId = rax.attach();
    
    try {
      await axios.get(url + '/config', {
        raxConfig: {
          retry: 1,
          retryDelay: 10
        }
      });
    } catch (error) {
      const config = rax.getConfig(error);
      assert.ok(config, 'config should exist');
      assert.strictEqual(config.retry, 1, 'retry should be 1');
      assert.strictEqual(config.currentRetryAttempt, 1, 'should have attempted retry');
      scope.done();
    }
  });
});