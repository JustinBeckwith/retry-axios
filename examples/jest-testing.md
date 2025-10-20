# Testing retry-axios with Jest

This guide demonstrates how to test code that uses `retry-axios` in Jest.

## The Challenge

When testing retry logic, you need to ensure that:
1. Failed requests are actually retried
2. The correct number of retries occur
3. Retry configuration is respected

## Recommended Approach: Use `nock`

The best way to test retry-axios is with [nock](https://github.com/nock/nock), which intercepts HTTP requests at the network level. This works because retry-axios uses axios interceptors, and nock works below that layer.

### Installation

```bash
npm install --save-dev jest nock
```

### Example Test

```javascript
const axios = require('axios');
const nock = require('nock');
const rax = require('retry-axios');

describe('retry-axios with Jest', () => {
  let axiosInstance;
  let interceptorId;

  beforeEach(() => {
    // Create a custom axios instance for testing
    // This is recommended over using the global axios instance
    axiosInstance = axios.create();
    axiosInstance.defaults.raxConfig = {
      instance: axiosInstance
    };
    interceptorId = rax.attach(axiosInstance);
  });

  afterEach(() => {
    // Clean up
    nock.cleanAll();
    if (interceptorId !== undefined) {
      rax.detach(interceptorId, axiosInstance);
    }
  });

  test('should retry failed requests', async () => {
    const url = 'https://api.example.com';

    // Set up nock to return a 500 error first, then success
    const scope = nock(url)
      .get('/data')
      .reply(500, { error: 'Server Error' })
      .get('/data')
      .reply(200, { success: true });

    const response = await axiosInstance.get(`${url}/data`, {
      raxConfig: {
        retry: 3,
        retryDelay: 100,
        backoffType: 'static'
      }
    });

    expect(response.status).toBe(200);
    expect(response.data).toEqual({ success: true });

    // Verify all nock requests were made
    scope.done();
  });

  test('should respect retry count', async () => {
    const url = 'https://api.example.com';

    // Set up nock to fail 3 times
    const scope = nock(url)
      .get('/fail')
      .times(3)
      .reply(500, { error: 'Server Error' });

    const config = {
      raxConfig: {
        retry: 2, // Will make initial request + 2 retries = 3 total
        retryDelay: 10,
        backoffType: 'static'
      }
    };

    await expect(
      axiosInstance.get(`${url}/fail`, config)
    ).rejects.toThrow();

    // Verify exactly 3 requests were made
    scope.done();
  });

  test('should call onRetryAttempt callback', async () => {
    const url = 'https://api.example.com';
    const onRetryAttempt = jest.fn().mockResolvedValue(undefined);

    const scope = nock(url)
      .get('/retry')
      .reply(500)
      .get('/retry')
      .reply(200, { success: true });

    await axiosInstance.get(`${url}/retry`, {
      raxConfig: {
        retry: 3,
        retryDelay: 10,
        backoffType: 'static',
        onRetryAttempt
      }
    });

    // Verify callback was called once (for the retry)
    expect(onRetryAttempt).toHaveBeenCalledTimes(1);
    expect(onRetryAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.any(Object)
      })
    );

    scope.done();
  });

  test('should call onError callback', async () => {
    const url = 'https://api.example.com';
    const onError = jest.fn().mockResolvedValue(undefined);

    const scope = nock(url)
      .get('/error')
      .reply(500)
      .get('/error')
      .reply(200, { success: true });

    await axiosInstance.get(`${url}/error`, {
      raxConfig: {
        retry: 3,
        retryDelay: 10,
        backoffType: 'static',
        onError
      }
    });

    // onError is called immediately when error occurs (before retry)
    expect(onError).toHaveBeenCalledTimes(1);

    scope.done();
  });
});
```

## Testing with axios-mock-adapter

An alternative approach is using [axios-mock-adapter](https://github.com/ctimmerm/axios-mock-adapter):

```javascript
const axios = require('axios');
const MockAdapter = require('axios-mock-adapter');
const rax = require('retry-axios');

describe('retry-axios with axios-mock-adapter', () => {
  let mock;
  let interceptorId;

  beforeEach(() => {
    mock = new MockAdapter(axios);
    interceptorId = rax.attach();
  });

  afterEach(() => {
    mock.restore();
    if (interceptorId !== undefined) {
      rax.detach(interceptorId);
    }
  });

  test('should retry with axios-mock-adapter', async () => {
    // Chain responses: fail then succeed
    mock.onGet('/api/data').replyOnce(500, { error: 'Server Error' });
    mock.onGet('/api/data').replyOnce(200, { success: true });

    const response = await axios.get('/api/data', {
      raxConfig: {
        retry: 3,
        retryDelay: 10,
        backoffType: 'static'
      }
    });

    expect(response.status).toBe(200);
    expect(response.data).toEqual({ success: true });
  });
});
```

## Testing Your Own Functions

Here's how to test a function that uses retry-axios:

```javascript
// src/api.js
const axios = require('axios');
const rax = require('retry-axios');

async function fetchData(url) {
  rax.attach();
  const response = await axios.get(url, {
    raxConfig: {
      retry: 3,
      noResponseRetries: 3,
      retryDelay: 100,
      backoffType: 'exponential'
    }
  });
  return response.data;
}

module.exports = { fetchData };
```

```javascript
// src/api.test.js
const nock = require('nock');
const { fetchData } = require('./api');

describe('fetchData', () => {
  afterEach(() => {
    nock.cleanAll();
  });

  test('should retry on failure and return data on success', async () => {
    const url = 'https://api.example.com';

    const scope = nock(url)
      .get('/users')
      .reply(500)
      .get('/users')
      .reply(500)
      .get('/users')
      .reply(200, { users: ['Alice', 'Bob'] });

    const data = await fetchData(`${url}/users`);

    expect(data).toEqual({ users: ['Alice', 'Bob'] });
    scope.done();
  });
});
```

## CommonJS vs ESM

retry-axios supports both CommonJS and ES modules:

### CommonJS
```javascript
const rax = require('retry-axios');
const axios = require('axios');
```

### ES Modules
```javascript
import * as rax from 'retry-axios';
import axios from 'axios';
```

Jest should automatically pick the correct format based on your project configuration.

## Tips

1. **Use a custom axios instance** instead of the global one - this prevents test isolation issues and is more reliable in Jest
2. **Use `nock.cleanAll()` in `afterEach`** to prevent test pollution
3. **Always call `rax.detach()`** with the instance parameter to clean up interceptors
4. **Use `scope.done()`** to verify all expected requests were made
5. **Keep retry delays low** in tests (10-100ms) to speed up test runs
6. **Test both success and failure scenarios** to ensure retry logic works correctly

## Common Issues

### Issue: Tests hang or timeout
- Make sure you're cleaning up with `nock.cleanAll()` and `rax.detach()`
- Check that your retry delays aren't too long
- Ensure nock scope matches all expected requests

### Issue: "Nock: No match for request"
- Verify the URL in your test matches exactly (including protocol, host, path)
- Check that you've set up enough nock replies for the number of retries

### Issue: Retries aren't happening
- Make sure `rax.attach()` is called before making the axios request
- Verify the error status code is in `statusCodesToRetry` (defaults to 5xx, 429, and 1xx)
- Check that the HTTP method is in `httpMethodsToRetry` (defaults include GET, HEAD, PUT, OPTIONS, DELETE)
