# Changelog

## [4.0.1](https://github.com/JustinBeckwith/retry-axios/compare/retry-axios-v4.0.0...retry-axios-v4.0.1) (2025-11-09)


### Bug Fixes

* Switch Codecov to OIDC tokenless authentication ([#318](https://github.com/JustinBeckwith/retry-axios/issues/318)) ([75e5b6d](https://github.com/JustinBeckwith/retry-axios/commit/75e5b6d77e9c2a0167954e9a37b1373a74f5ad8b))

## [4.0.0](https://github.com/JustinBeckwith/retry-axios/compare/v3.2.1...f4e641f) (2025-10-20)


### ⚠ BREAKING CHANGES

This major release includes several breaking changes that simplify the API and improve consistency. Please review the migration guide below for each change.

#### 1. Node.js Version Requirements

**This library now requires Node.js 20 or higher.** Previous versions supported Node.js 6, 8, 12, and 14, which are all now end-of-life.

**Migration Required:** Upgrade your Node.js version to 20 or higher before upgrading to retry-axios 4.0.

```bash
# Check your Node.js version
node --version

# If below v20, upgrade Node.js first
# Visit https://nodejs.org or use a version manager like nvm
```

#### 2. Removal of `config.instance` Option

**The `config.instance` option has been removed.** The axios instance is now automatically used from the interceptor attachment point.

This was confusing because users had to specify the instance twice - once in `raxConfig` and once in `rax.attach()`. Now you only specify it once in `rax.attach()`.

**Before (v3.x):**
```js
const myAxiosInstance = axios.create();
myAxiosInstance.defaults.raxConfig = {
  instance: myAxiosInstance,  // ❌ Remove this
  retry: 3
};
rax.attach(myAxiosInstance);
```

**After (v4.0):**
```js
const myAxiosInstance = axios.create();
myAxiosInstance.defaults.raxConfig = {
  retry: 3  // ✅ Instance is automatically used from rax.attach()
};
rax.attach(myAxiosInstance);
```

**Migration Required:** Remove the `instance` property from your `raxConfig` objects.

#### 3. Simplified Retry Configuration - Removal of `noResponseRetries`

**The `noResponseRetries` configuration option has been removed.** The `retry` option now controls the maximum number of retries for ALL error types (both response errors like 5xx and network errors like timeouts).

This simplifies the API to match industry standards. Popular libraries like axios-retry, Got, and Ky all use a single retry count.

**Before (v3.x):**
```js
raxConfig: {
  retry: 3,              // For 5xx response errors
  noResponseRetries: 2   // For network/timeout errors
}
```

**After (v4.0):**
```js
raxConfig: {
  retry: 3  // For ALL errors (network + response errors)
}
```

**If you need different behavior** for network errors vs response errors, use the `shouldRetry` callback:

```js
raxConfig: {
  retry: 5,
  shouldRetry: (err) => {
    const cfg = rax.getConfig(err);

    // Network error (no response) - allow up to 5 retries
    if (!err.response) {
      return cfg.currentRetryAttempt < 5;
    }

    // Response error (5xx, 429, etc) - limit to 2 retries
    return cfg.currentRetryAttempt < 2;
  }
}
```

**Migration Required:**
- If you used `noResponseRetries`, remove it and adjust your `retry` value as needed
- If you need different retry counts for different error types, implement a `shouldRetry` function

#### 4. `onRetryAttempt` Now Requires Async Functions

**The `onRetryAttempt` callback must now return a Promise.** It will be awaited before the retry attempt proceeds. If the Promise is rejected, the retry will be aborted.

Additionally, the **timing has changed**: `onRetryAttempt` is now called AFTER the backoff delay (right before the retry), not before. A new `onError` callback has been added that fires immediately when an error occurs.

**Before (v3.x):**
```js
raxConfig: {
  onRetryAttempt: (err) => {
    // Synchronous callback, called before backoff delay
    console.log('About to retry');
  }
}
```

**After (v4.0):**
```js
raxConfig: {
  // Called immediately when error occurs, before backoff delay
  onError: async (err) => {
    console.log('Error occurred, will retry after backoff');
  },

  // Called after backoff delay, before retry attempt
  onRetryAttempt: async (err) => {
    console.log('About to retry now');
    // Can perform async operations like refreshing tokens
    const token = await refreshAuthToken();
    // If this throws, the retry is aborted
  }
}
```

**Common use case - Refreshing authentication tokens:**
```js
raxConfig: {
  retry: 3,
  onRetryAttempt: async (err) => {
    // Refresh expired token before retrying
    if (err.response?.status === 401) {
      const newToken = await refreshToken();
      // Update the authorization header for the retry
      err.config.headers.Authorization = `Bearer ${newToken}`;
    }
  }
}
```

**Migration Required:**
- Change `onRetryAttempt` to be an async function or return a Promise
- If you need immediate error notification (old `onRetryAttempt` timing), use the new `onError` callback instead
- If your callback throws or rejects, be aware this will now abort the retry

#### Summary of All Breaking Changes

1. **Node.js 20+ required** - Drops support for Node.js 6, 8, 12, and 14
2. **Remove `config.instance`** - Axios instance is now automatically used from `rax.attach()`
3. **Remove `noResponseRetries`** - Use `retry` for all error types, or implement `shouldRetry` for custom logic
4. **`onRetryAttempt` must be async** - Must return a Promise, called after backoff delay (use `onError` for immediate notification)

### Features

* accept promises on config.onRetryAttempt ([#23](https://github.com/JustinBeckwith/retry-axios/issues/23)) ([acfbe39](https://github.com/JustinBeckwith/retry-axios/commit/acfbe399f7017a607c4f49c578250a82834c448c))
* add configurable backoffType ([#76](https://github.com/JustinBeckwith/retry-axios/issues/76)) ([6794d85](https://github.com/JustinBeckwith/retry-axios/commit/6794d85c6cdd8e27bc59f613392caff8ddada985))
* Add jitter support and use retryDelay as base for exponential backoff ([#314](https://github.com/JustinBeckwith/retry-axios/issues/314)) ([7436b59](https://github.com/JustinBeckwith/retry-axios/commit/7436b59ff9a06011b47796afd6d2e3ade954ad5c))
* Add retriesRemaining property to track remaining retry attempts ([#316](https://github.com/JustinBeckwith/retry-axios/issues/316)) ([2d1f46b](https://github.com/JustinBeckwith/retry-axios/commit/2d1f46ba33cd4fdde0fd50c56a65746a178b67f2))
* add support for cjs ([#291](https://github.com/JustinBeckwith/retry-axios/issues/291)) ([38244be](https://github.com/JustinBeckwith/retry-axios/commit/38244be3b67c3316eea467f10ed3c4d8027b9fb5))
* add support for configurable http methods ([819855c](https://github.com/JustinBeckwith/retry-axios/commit/819855c99e3fda19615e9f0d704988d985df5036))
* add support for noResponseRetries ([d2cfde7](https://github.com/JustinBeckwith/retry-axios/commit/d2cfde70e6314bc298dcf9291bacb3385c130cdf))
* add support for onRetryAttempt handler ([fa17de4](https://github.com/JustinBeckwith/retry-axios/commit/fa17de46bd6c6c33db99aca5668a3d58a81c761e))
* add support for overriding shouldRetry ([76fcff5](https://github.com/JustinBeckwith/retry-axios/commit/76fcff59849b7b9de428f9638ff5057c159a1a3d))
* add support for statusCodesToRetry ([9283c9e](https://github.com/JustinBeckwith/retry-axios/commit/9283c9e40970eaf359ac664ce5ac6517087c3257))
* allow retryDelay to be 0 ([#132](https://github.com/JustinBeckwith/retry-axios/issues/132)) ([57ba46f](https://github.com/JustinBeckwith/retry-axios/commit/57ba46f563561e6b9e4f1e2ca39daefe2993d399))
* Collect all errors in errors array during retry attempts ([#315](https://github.com/JustinBeckwith/retry-axios/issues/315)) ([a7ae9e1](https://github.com/JustinBeckwith/retry-axios/commit/a7ae9e1df42f7af3448cf3eca00d95035c37ecf4))
* configurable maxRetryDelay ([#165](https://github.com/JustinBeckwith/retry-axios/issues/165)) ([b8842d7](https://github.com/JustinBeckwith/retry-axios/commit/b8842d751482caf31bc1c090cda3c7923d1f23fa))
* drop support for node.js 6, add 12 ([78ea044](https://github.com/JustinBeckwith/retry-axios/commit/78ea044f17b0d1900509994b36bda31da17ea360))
* export the shouldRetryRequest method ([#74](https://github.com/JustinBeckwith/retry-axios/issues/74)) ([694d638](https://github.com/JustinBeckwith/retry-axios/commit/694d638ccc0d91727cbcd9990690a9b29815353c))
* produce es, common, and umd bundles ([#107](https://github.com/JustinBeckwith/retry-axios/issues/107)) ([62cabf5](https://github.com/JustinBeckwith/retry-axios/commit/62cabf58c86ffc8169b74b8912f2aac94a703733))
* Remove redundant config.instance option ([#312](https://github.com/JustinBeckwith/retry-axios/issues/312)) ([402723d](https://github.com/JustinBeckwith/retry-axios/commit/402723d264b6429c6c1fa1f20163a10c9b1e8091))
* ship source maps ([#223](https://github.com/JustinBeckwith/retry-axios/issues/223)) ([247fae0](https://github.com/JustinBeckwith/retry-axios/commit/247fae0434fb3e495f7ec3518da19a25a3be1704))
* Simplify retry configuration API ([#311](https://github.com/JustinBeckwith/retry-axios/issues/311)) ([cb447b3](https://github.com/JustinBeckwith/retry-axios/commit/cb447b3b4a6db5461dd46bc8149e4660de4c9a81))
* support retry-after header ([#142](https://github.com/JustinBeckwith/retry-axios/issues/142)) ([5c6cace](https://github.com/JustinBeckwith/retry-axios/commit/5c6cace7fbf418285c3b0f114f5806cb573b0a64))
* support the latest versions of node.js ([#188](https://github.com/JustinBeckwith/retry-axios/issues/188)) ([ef74217](https://github.com/JustinBeckwith/retry-axios/commit/ef74217113cf611af420564421d844858d70701b))
* umd compatibility with babel 7.x ([#21](https://github.com/JustinBeckwith/retry-axios/issues/21)) ([f1b336c](https://github.com/JustinBeckwith/retry-axios/commit/f1b336c00a03f56ba7874a9565955c89c32b1d68))


### Bug Fixes

* added check for cancel tokens ([#99](https://github.com/JustinBeckwith/retry-axios/issues/99)) ([734a93f](https://github.com/JustinBeckwith/retry-axios/commit/734a93ff45de7dfd827f17ec7e7545636a3e8add))
* Call onRetryAttempt *after* backoff timeout ([#307](https://github.com/JustinBeckwith/retry-axios/issues/307)) ([a5457e4](https://github.com/JustinBeckwith/retry-axios/commit/a5457e44a808dc82aabbd07a2abd3a57de2befe8))
* cannot set propery raxConfig of undefined ([#114](https://github.com/JustinBeckwith/retry-axios/issues/114)) ([0be8578](https://github.com/JustinBeckwith/retry-axios/commit/0be857823f4e4845e72891ba63cef08d006cefc8))
* **deps:** update dependency gts to v1 ([#45](https://github.com/JustinBeckwith/retry-axios/issues/45)) ([1dc0f2f](https://github.com/JustinBeckwith/retry-axios/commit/1dc0f2f77b52cd6fcbec69f31c70fc5f2e0f084e))
* Don't store counter on input config object ([#98](https://github.com/JustinBeckwith/retry-axios/issues/98)) ([c8ceec0](https://github.com/JustinBeckwith/retry-axios/commit/c8ceec0e16e57297edbc0739f40b99a836e3254e)), closes [#61](https://github.com/JustinBeckwith/retry-axios/issues/61)
* ensure config is set ([#81](https://github.com/JustinBeckwith/retry-axios/issues/81)) ([88ffd00](https://github.com/JustinBeckwith/retry-axios/commit/88ffd005a9a659ee75f545d3b1b4df8d00b78ceb))
* fix instructions and test for non-static instnaces ([544c2a6](https://github.com/JustinBeckwith/retry-axios/commit/544c2a6563c3c4df69d5d441bbaf872a0a59d83f))
* Fix potential exception when there is no response ([#258](https://github.com/JustinBeckwith/retry-axios/issues/258)) ([a58cd1d](https://github.com/JustinBeckwith/retry-axios/commit/a58cd1d013dc86385d75bb83a8798fb41d1a89f1))
* Fix workaround for arrays that are passed as objects ([#238](https://github.com/JustinBeckwith/retry-axios/issues/238)) ([6e2454a](https://github.com/JustinBeckwith/retry-axios/commit/6e2454a139a76a3376ea7e16f4e0566345e683c8))
* handle arrays that are converted to objects ([#83](https://github.com/JustinBeckwith/retry-axios/issues/83)) ([554fd4c](https://github.com/JustinBeckwith/retry-axios/commit/554fd4ca444a0dd5237bccdc3d156c481cce8f42))
* include files in the release ([#29](https://github.com/JustinBeckwith/retry-axios/issues/29)) ([30663b3](https://github.com/JustinBeckwith/retry-axios/commit/30663b362bd1eddf33c6390e4df8123fa295d37e))
* non-zero delay between first attempt and first retry for linear and exp strategy ([#163](https://github.com/JustinBeckwith/retry-axios/issues/163)) ([e63ca08](https://github.com/JustinBeckwith/retry-axios/commit/e63ca084f5372f03debe5c082e6b924684072345))
* onRetryAttempt does not handle promise rejection ([#306](https://github.com/JustinBeckwith/retry-axios/issues/306)) ([6f5ecc2](https://github.com/JustinBeckwith/retry-axios/commit/6f5ecc274d7ffa85cdcfd52fff9635fabb55a3a7))
* preserve configuration for custom instance ([#240](https://github.com/JustinBeckwith/retry-axios/issues/240)) ([2e4e702](https://github.com/JustinBeckwith/retry-axios/commit/2e4e702feb38b2b49e8de776c85a85a4599a1b04))
* Respect retry limit when using custom shouldRetry ([#309](https://github.com/JustinBeckwith/retry-axios/issues/309)) ([58f6fa6](https://github.com/JustinBeckwith/retry-axios/commit/58f6fa6f1e0af47879c954542eecf4daac8cc7b6))
* **typescript:** include raxConfig in native axios types ([#85](https://github.com/JustinBeckwith/retry-axios/issues/85)) ([b8b0456](https://github.com/JustinBeckwith/retry-axios/commit/b8b04565004b100cc36ac1f5ee32dfde34f0770f))
* Update tsconfig.json to emit index.d.ts ([#229](https://github.com/JustinBeckwith/retry-axios/issues/229)) ([bff6aa9](https://github.com/JustinBeckwith/retry-axios/commit/bff6aa9f50434d3718f78b68e4de6dab6a14e705))


### Miscellaneous Chores

* drop support for nodejs 8.x ([#82](https://github.com/JustinBeckwith/retry-axios/issues/82)) ([d259697](https://github.com/JustinBeckwith/retry-axios/commit/d259697ab5e9931c7ceaddff6c48d43180dda6c6))


### Build System

* require node.js 20 and up ([#317](https://github.com/JustinBeckwith/retry-axios/issues/317)) ([4aa6440](https://github.com/JustinBeckwith/retry-axios/commit/4aa644002a0597067ccf8735779fa073d165e7a2))
