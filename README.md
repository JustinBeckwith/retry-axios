# retry-axios

> Use Axios interceptors to automatically retry failed requests.  Super flexible. Built in exponential backoff.

![retry-axios](https://raw.githubusercontent.com/justinbeckwith/retry-axios/main/site/retry-axios.webp)

[![NPM Version][npm-image]][npm-url]
[![GitHub Actions][github-image]][github-url]
[![Known Vulnerabilities][snyk-image]][snyk-url]
[![codecov][codecov-image]][codecov-url]
[![Biome][biome-image]][biome-url]

## Installation

```sh
npm install retry-axios
```

## CDN

For front-end applications, you can also use `retry-axios` directly from a CDN without a build step. This is useful for quick prototypes or environments where you can't use npm.

### jsDelivr

```html
<script src="https://cdn.jsdelivr.net/npm/axios/dist/axios.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/retry-axios@4.0.0/build/src/index.js"></script>
<script>
  // Attach retry-axios to the global axios object
  rax.attach();

  // Now you can use axios with retry capabilities
  axios.get('https://httpbin.org/status/503')
    .then(response => {
      console.log('Success:', response.data);
    })
    .catch(error => {
      console.error('Error:', error.message);
    });
</script>
```

### unpkg

```html
<script src="https://unpkg.com/axios/dist/axios.min.js"></script>
<script src="https://unpkg.com/retry-axios@4.0.0/build/src/index.js"></script>
<script>
  // Attach retry-axios to the global axios object
  rax.attach();

  // Now you can use axios with retry capabilities
  axios.get('https://httpbin.org/status/503')
    .then(response => {
      console.log('Success:', response.data);
    })
    .catch(error => {
      console.error('Error:', error.message);
    });
</script>
```

## Usage

To use this library, import it alongside of `axios`:

```js
// Just import rax and your favorite version of axios
const rax = require('retry-axios');
const axios = require('axios');
```

Or, if you're using TypeScript / es modules:

```js
import * as rax from 'retry-axios';
import axios from 'axios';
```

You can attach to the global `axios` object, and retry 3 times by default:

```js
const interceptorId = rax.attach();
const res = await axios('https://test.local');
```

Or you can create your own axios instance to make scoped requests:

```js
const myAxiosInstance = axios.create();
myAxiosInstance.defaults.raxConfig = {
  retry: 3
};
const interceptorId = rax.attach(myAxiosInstance);
const res = await myAxiosInstance.get('https://test.local');
```

You have a lot of options...

```js
const interceptorId = rax.attach();
const res = await axios({
  url: 'https://test.local',
  raxConfig: {
    // Retry 3 times before giving up. Applies to all errors (5xx, network errors, timeouts, etc). Defaults to 3.
    retry: 3,

    // Milliseconds to delay between retries. Defaults to 100.
    // - For 'static': Fixed delay between retries
    // - For 'exponential': Base multiplier for exponential calculation
    // - For 'linear': Ignored (uses attempt * 1000)
    retryDelay: 100,

    // HTTP methods to automatically retry.  Defaults to:
    // ['GET', 'HEAD', 'OPTIONS', 'DELETE', 'PUT']
    httpMethodsToRetry: ['GET', 'HEAD', 'OPTIONS', 'DELETE', 'PUT'],

    // The response status codes to retry.  Supports a double
    // array with a list of ranges.  Defaults to:
    // [[100, 199], [429, 429], [500, 599]]
    statusCodesToRetry: [[100, 199], [429, 429], [500, 599]],

    // You can set the backoff type.
    // options are 'exponential' (default), 'static' or 'linear'
    backoffType: 'exponential',

    // Jitter strategy for exponential backoff. Defaults to 'none'.
    // Options: 'none', 'full', 'equal'
    // Helps prevent thundering herd in distributed systems
    jitter: 'full',

    // You can detect when an error occurs, before the backoff delay
    onError: async (err) => {
      const cfg = rax.getConfig(err);
      console.log(`Error occurred, retry attempt #${cfg.currentRetryAttempt + 1} will happen after backoff`);
    },

    // You can detect when a retry attempt is about to be made, after the backoff delay
    onRetryAttempt: async (err) => {
      const cfg = rax.getConfig(err);
      console.log(`Retry attempt #${cfg.currentRetryAttempt} is about to start`);
      console.log(`Retries remaining: ${cfg.retriesRemaining}`);

      // Check if this is the final retry attempt
      if (cfg.retriesRemaining === 0) {
        console.log('This is the final retry attempt');
      }
    }
  }
});
```

### Backoff Types and Timing

The `backoffType` option controls how delays between retry attempts are calculated. There are three strategies available:

#### Exponential Backoff (default)

Uses the formula: `((2^attempt - 1) / 2) * retryDelay` milliseconds

The `retryDelay` parameter (defaults to 100ms) is used as the base multiplier for the exponential calculation.

Example timing with default `retryDelay: 100`:
- Retry 1: 50ms delay
- Retry 2: 150ms delay
- Retry 3: 350ms delay
- Retry 4: 750ms delay
- Retry 5: 1,550ms delay

Example timing with `retryDelay: 1000`:
- Retry 1: 500ms delay
- Retry 2: 1,500ms delay
- Retry 3: 3,500ms delay
- Retry 4: 7,500ms delay
- Retry 5: 15,500ms delay

```js
raxConfig: {
  backoffType: 'exponential',  // This is the default
  retryDelay: 1000,  // Use 1000ms as the base multiplier
  retry: 5
}
```

#### Static Backoff

Uses a fixed delay specified by `retryDelay` (defaults to 100ms if not set).

Example timing with `retryDelay: 3000`:
- Retry 1: 3,000ms delay
- Retry 2: 3,000ms delay
- Retry 3: 3,000ms delay

```js
raxConfig: {
  backoffType: 'static',
  retryDelay: 3000,  // 3 seconds between each retry
  retry: 3
}
```

#### Linear Backoff

Delay increases linearly: `attempt * 1000` milliseconds

**The `retryDelay` option is ignored when using linear backoff.**

Example timing for the first 5 retries:
- Retry 1: 1,000ms delay
- Retry 2: 2,000ms delay
- Retry 3: 3,000ms delay
- Retry 4: 4,000ms delay
- Retry 5: 5,000ms delay

```js
raxConfig: {
  backoffType: 'linear',
  retry: 5
}
```

#### Maximum Retry Delay

You can cap the maximum delay for any backoff type using `maxRetryDelay`:

```js
raxConfig: {
  backoffType: 'exponential',
  maxRetryDelay: 5000,  // Never wait more than 5 seconds
  retry: 10
}
```

#### Jitter

Jitter adds randomness to exponential backoff delays to prevent the "thundering herd" problem where many clients retry at the same time. This is especially useful in distributed systems.

Available jitter strategies (only applies to exponential backoff):

**No Jitter (default)**
```js
raxConfig: {
  backoffType: 'exponential',
  jitter: 'none',  // or omit this option
  retryDelay: 1000
}
// Retry 1: exactly 500ms
// Retry 2: exactly 1,500ms
// Retry 3: exactly 3,500ms
```

**Full Jitter**

Randomizes the delay between 0 and the calculated exponential backoff:

```js
raxConfig: {
  backoffType: 'exponential',
  jitter: 'full',
  retryDelay: 1000
}
// Retry 1: random between 0-500ms
// Retry 2: random between 0-1,500ms
// Retry 3: random between 0-3,500ms
```

**Equal Jitter**

Uses half fixed delay, half random:

```js
raxConfig: {
  backoffType: 'exponential',
  jitter: 'equal',
  retryDelay: 1000
}
// Retry 1: 250ms + random(0-250ms) = 250-500ms
// Retry 2: 750ms + random(0-750ms) = 750-1,500ms
// Retry 3: 1,750ms + random(0-1,750ms) = 1,750-3,500ms
```

**Recommendation:** Use `'full'` jitter for most distributed systems to minimize collision probability while maintaining good retry timing.

### Callback Timing

There are two callbacks you can use to hook into the retry lifecycle:

- **`onError`**: Called immediately when an error occurs, before the backoff delay. Use this for logging errors or performing actions that need to happen right away.
- **`onRetryAttempt`**: Called after the backoff delay, just before the retry request is made. Use this for actions that need to happen right before retrying (like refreshing tokens).

Both functions are asynchronous and must return a promise. The retry will wait for the promise to resolve before proceeding. If the promise is rejected, the retry will be aborted:

```js
const res = await axios({
  url: 'https://test.local',
  raxConfig: {
    onError: async (err) => {
      // Called immediately when error occurs
      console.log('An error occurred, will retry after backoff');
    },
    onRetryAttempt: async (err) => {
      // Called after backoff delay, before retry
      const token = await refreshToken(err);
      window.localStorage.setItem('token', token);
      // If refreshToken throws or this promise rejects,
      // the retry will be aborted
    }
  }
});
```

## Tracking Retry Progress

You can track the current retry state using properties available in the configuration:

- **`currentRetryAttempt`**: The number of retries that have been attempted (starts at 0, increments with each retry)
- **`retriesRemaining`**: The number of retries left before giving up (calculated as `retry - currentRetryAttempt`)

These properties are particularly useful when you want to show different messages or take different actions based on whether this is the final retry attempt:

```js
const res = await axios({
  url: 'https://test.local',
  raxConfig: {
    retry: 3,
    onRetryAttempt: async (err) => {
      const cfg = rax.getConfig(err);

      console.log(`Retry attempt ${cfg.currentRetryAttempt} of ${cfg.retry}`);
      console.log(`${cfg.retriesRemaining} retries remaining`);

      // Show user-facing error only on final retry
      if (cfg.retriesRemaining === 0) {
        showErrorNotification('Request failed after multiple attempts');
      }
    }
  }
});
```

This is especially useful when chaining retry-axios with other error interceptors:

```js
// Global error handler that shows notifications
axios.interceptors.response.use(null, async (error) => {
  const cfg = rax.getConfig(error);

  // Only show error notification on the final retry attempt
  // Don't spam the user with notifications for intermediate failures
  if (cfg?.retriesRemaining === 0) {
    showUserNotification('An error occurred: ' + error.message);
  }

  return Promise.reject(error);
});

// Attach retry interceptor
rax.attach();
```

## Customizing Retry Logic

You can customize which errors should trigger a retry using the `shouldRetry` function:

```js
const res = await axios({
  url: 'https://test.local',
  raxConfig: {
    retry: 3,
    // Custom logic to decide if a request should be retried
    // This is called AFTER checking the retry count limit
    shouldRetry: err => {
      const cfg = rax.getConfig(err);

      // Don't retry on 4xx errors except 429
      if (err.response?.status && err.response.status >= 400 && err.response.status < 500) {
        return err.response.status === 429;
      }

      // Retry on network errors and 5xx errors
      return true;
    }
  }
});
```

If you want to add custom retry logic without duplicating too much of the built-in logic, `rax.shouldRetryRequest` will tell you if a request would normally be retried:

```js
const res = await axios({
  url: 'https://test.local',
  raxConfig: {
    // Override the decision making process on if you should retry
    shouldRetry: err => {
      const cfg = rax.getConfig(err);
      if (cfg.currentRetryAttempt >= cfg.retry) return false // ensure max retries is always respected

      // Always retry this status text, regardless of code or request type
      if (err.response.statusText.includes('Try again')) return true

      // Handle the request based on your other config options, e.g. `statusCodesToRetry`
      return rax.shouldRetryRequest(err)
    }
  }
});
```

## Accessing All Retry Errors

When retries are exhausted and the request finally fails, you can access the complete history of all errors that occurred during the retry attempts. This is particularly useful for debugging and understanding what went wrong, especially for non-idempotent operations like POST requests where the error may change between attempts.

```js
try {
  await axios.post('https://test.local/api/endpoint', data, {
    raxConfig: {
      httpMethodsToRetry: ['POST'],
      retry: 3
    }
  });
} catch (err) {
  const cfg = rax.getConfig(err);

  // Access all errors encountered during retries
  if (cfg?.errors) {
    console.log(`Total attempts: ${cfg.errors.length}`);
    console.log(`First error: ${cfg.errors[0].response?.status}`);
    console.log(`Last error: ${err.response?.status}`);

    // Log all error details
    cfg.errors.forEach((error, index) => {
      console.log(`Attempt ${index + 1}: ${error.response?.status} - ${error.response?.data}`);
    });
  }
}
```

The `errors` array is automatically populated and contains:
- **First element**: The initial error that triggered the retry logic
- **Subsequent elements**: Errors from each retry attempt
- **Order**: Errors are in chronological order (oldest to newest)

This feature is especially valuable when:
- Debugging complex failure scenarios where errors change between attempts
- Implementing custom error handling logic that needs to consider all failures
- Logging and monitoring to understand the full context of request failures
- Working with non-idempotent operations where side effects may occur

## What Gets Retried

By default, retry-axios will retry requests that:

1. **Return specific HTTP status codes**: 1xx (informational), 429 (too many requests), and 5xx (server errors)
2. **Are network errors without a response**: ETIMEDOUT, ENOTFOUND, ECONNABORTED, ECONNRESET, etc.
3. **Use idempotent HTTP methods**: GET, HEAD, PUT, OPTIONS, DELETE

The `retry` config option controls the maximum number of retry attempts for **all** error types. If you need different behavior for network errors vs response errors, use the `shouldRetry` function to implement custom logic.

## How it works

This library attaches an `interceptor` to an axios instance you pass to the API. This way you get to choose which version of `axios` you want to run, and you can compose many interceptors on the same request pipeline.

## License

[Apache-2.0](LICENSE)

[github-image]: https://github.com/JustinBeckwith/retry-axios/workflows/ci/badge.svg
[github-url]: https://github.com/JustinBeckwith/retry-axios/actions/
[codecov-image]: https://codecov.io/gh/JustinBeckwith/retry-axios/branch/main/graph/badge.svg
[codecov-url]: https://codecov.io/gh/JustinBeckwith/retry-axios
[npm-image]: https://img.shields.io/npm/v/retry-axios.svg
[npm-url]: https://npmjs.org/package/retry-axios
[snyk-image]: https://snyk.io/test/github/JustinBeckwith/retry-axios/badge.svg
[snyk-url]: https://snyk.io/test/github/JustinBeckwith/retry-axios
[biome-image]: https://img.shields.io/badge/Biome-60a5fa?style=flat&logo=biome&logoColor=fff
[biome-url]: https://biomejs.dev
