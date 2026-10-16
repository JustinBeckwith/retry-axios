import pDefer from 'p-defer';

// Nock 15's interceptor dependency uses this Node 22 API. Keep the test
// harness working on Node 20 without adding a polyfill to the library.
Promise.withResolvers ??= pDefer;
