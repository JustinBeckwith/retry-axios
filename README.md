# retry-axios

[![NPM Version][npm-image]][npm-url]
[![CircleCI][circle-image]][circle-url]
[![Dependency Status][david-image]][david-url]
[![devDependency Status][david-dev-image]][david-dev-url]
[![Known Vulnerabilities][snyk-image]][snyk-url]
[![codecov][codecov-image]][codecov-url]
[![Greenkeeper badge][greenkeeper-image]][greenkeeper-url]
[![style badge][gts-image]][gts-url]

Use Axios interceptors to automatically retry failed requests.

## Installation

``` sh
npm install retry-axios
```

## Usage

To use this library, import it alongside of `axios`:

```js
// Just import rax and your favorite version of axios
const rax = require('retry-axios');
const {axios} = require('axios');
```

You can attach to the global `axios` object, and retry 3 times by default:

```js
const interceptorId = rax.attach();
const res = await axios('https://test.local');
```

Or you can create your own axios instance to make scoped requests:

```js
const myAxiosInstance = axios.create();
const interceptorId = rax.attach(myAxiosInstance);
const res = await myAxiosInstance.get('https://test.local');
```

You can control the number of retries and backoff delay:

```js
const interceptorId = rax.attach();
const res = await axios({
  url: 'https://test.local',
  retry: 14,        // Retry 14 times before giving up
  retryDelay: 200,  // # milliseconds to delay at first
});
```

## How it works

This library attaches an `interceptor` to an axios instance you pass to the API.  This way you get to choose which version of `axios` you want to run, and you can compose many interceptors on the same request pipeline.

## License
[Apache-2.0](LICENSE)

[circle-image]: https://circleci.com/gh/JustinBeckwith/retry-axios.svg?style=svg
[circle-url]: https://circleci.com/gh/JustinBeckwith/retry-axios
[codecov-image]: https://codecov.io/gh/JustinBeckwith/retry-axios/branch/master/graph/badge.svg
[codecov-url]: https://codecov.io/gh/JustinBeckwith/retry-axios
[david-image]: https://david-dm.org/JustinBeckwith/retry-axios.svg
[david-url]: https://david-dm.org/JustinBeckwith/retry-axios
[david-dev-image]: https://david-dm.org/JustinBeckwith/retry-axios/dev-status.svg
[david-dev-url]: https://david-dm.org/JustinBeckwith/retry-axios?type=dev
[greenkeeper-image]: https://badges.greenkeeper.io/JustinBeckwith/retry-axios.svg
[greenkeeper-url]: https://greenkeeper.io/
[gts-image]: https://img.shields.io/badge/code%20style-Google%20%E2%98%82%EF%B8%8F-blue.svg
[gts-url]: https://www.npmjs.com/package/gts
[npm-image]: https://img.shields.io/npm/v/retry-axios.svg
[npm-url]: https://npmjs.org/package/retry-axios
[snyk-image]: https://snyk.io/test/github/JustinBeckwith/retry-axios/badge.svg
[snyk-url]: https://snyk.io/test/github/JustinBeckwith/retry-axios
