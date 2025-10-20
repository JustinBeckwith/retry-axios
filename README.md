# retry-axios

> Use Axios interceptors to automatically retry failed requests.  Super flexible. Built in exponential backoff.

[![NPM Version][npm-image]][npm-url]
[![GitHub Actions][github-image]][github-url]
[![Known Vulnerabilities][snyk-image]][snyk-url]
[![codecov][codecov-image]][codecov-url]
[![Biome][biome-image]][biome-url]

## Installation

```sh
npm install retry-axios
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
  instance: myAxiosInstance
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
    // Retry 3 times on requests that return a response (500, etc) before giving up.  Defaults to 3.
    retry: 3,

    // Retry twice on errors that don't return a response (ENOTFOUND, ETIMEDOUT, ECONNABORTED, etc).
    // This includes network errors and axios timeout errors (when using the 'timeout' config option).
    // 'noResponseRetries' is limited by the 'retry' value.
    noResponseRetries: 2,

    // Milliseconds to delay at first.  Defaults to 100. Only considered when backoffType is 'static'
    retryDelay: 100,

    // HTTP methods to automatically retry.  Defaults to:
    // ['GET', 'HEAD', 'OPTIONS', 'DELETE', 'PUT']
    httpMethodsToRetry: ['GET', 'HEAD', 'OPTIONS', 'DELETE', 'PUT'],

    // The response status codes to retry.  Supports a double
    // array with a list of ranges.  Defaults to:
    // [[100, 199], [429, 429], [500, 599]]
    statusCodesToRetry: [[100, 199], [429, 429], [500, 599]],

    // If you are using a non static instance of Axios you need
    // to pass that instance here (const ax = axios.create())
    instance: ax,

    // You can set the backoff type.
    // options are 'exponential' (default), 'static' or 'linear'
    backoffType: 'exponential',

    // You can detect when an error occurs, before the backoff delay
    onError: async (err) => {
      const cfg = rax.getConfig(err);
      console.log(`Error occurred, retry attempt #${cfg.currentRetryAttempt + 1} will happen after backoff`);
    },

    // You can detect when a retry attempt is about to be made, after the backoff delay
    onRetryAttempt: async (err) => {
      const cfg = rax.getConfig(err);
      console.log(`Retry attempt #${cfg.currentRetryAttempt} is about to start`);
    }
  }
});
```

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

Or if you want, you can just decide if it should retry or not:

```js
const res = await axios({
  url: 'https://test.local',
  raxConfig: {
    // Override the decision making process on if you should retry
    shouldRetry: err => {
      const cfg = rax.getConfig(err);
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

## Handling Timeouts

When using axios's `timeout` config option, timeout errors will be automatically retried. These errors are treated as "no response" errors and are controlled by the `noResponseRetries` config:

```js
const myAxiosInstance = axios.create({
  timeout: 5000  // Set axios timeout
});

myAxiosInstance.defaults.raxConfig = {
  instance: myAxiosInstance,
  retry: 3,              // Max retries for errors with responses (5xx, etc)
  noResponseRetries: 3,  // Max retries for errors without responses (timeouts, network errors, etc)
};

rax.attach(myAxiosInstance);

// This will retry up to 3 times if the request times out
const res = await myAxiosInstance.get('https://slow-api.example.com');
```

**Note:** `noResponseRetries` is independent from `retry`, but both are limited by whichever value is lower. If you want to retry timeouts specifically, make sure `noResponseRetries` is set appropriately.

## How it works

This library attaches an `interceptor` to an axios instance you pass to the API. This way you get to choose which version of `axios` you want to run, and you can compose many interceptors on the same request pipeline.

## License

[Apache-2.0](LICENSE)

[github-image]: https://github.com/JustinBeckwith/retry-axios/workflows/ci/badge.svg
[github-url]: https://github.com/JustinBeckwith/retry-axios/actions/
[codecov-image]: https://codecov.io/gh/JustinBeckwith/retry-axios/branch/main/graph/badge.svg
[codecov-url]: https://codecov.io/gh/JustinBeckwith/retry-axios
[gts-image]: https://img.shields.io/badge/code%20style-Google%20%E2%98%82%EF%B8%8F-blue.svg
[gts-url]: https://www.npmjs.com/package/gts
[npm-image]: https://img.shields.io/npm/v/retry-axios.svg
[npm-url]: https://npmjs.org/package/retry-axios
[snyk-image]: https://snyk.io/test/github/JustinBeckwith/retry-axios/badge.svg
[snyk-url]: https://snyk.io/test/github/JustinBeckwith/retry-axios
[biome-image]: https://img.shields.io/badge/Biome-60a5fa?style=flat&logo=biome&logoColor=fff
[biome-url]: https://biomejs.dev
