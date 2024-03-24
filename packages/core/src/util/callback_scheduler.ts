/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {global} from './global';

/**
 * Gets a scheduling function that runs the callback after the first of setTimeout and
 * requestAnimationFrame resolves.
 *
 * - `requestAnimationFrame` ensures that change detection runs ahead of a browser repaint.
 * This ensures that the create and update passes of a change detection always happen
 * in the same frame.
 * - When the browser is resource-starved, `rAF` can execute _before_ a `setTimeout` because
 * rendering is a very high priority process. This means that `setTimeout` cannot guarantee
 * same-frame create and update pass, when `setTimeout` is used to schedule the update phase.
 * - While `rAF` gives us the desirable same-frame updates, it has two limitations that
 * prevent it from being used alone. First, it does not run in background tabs, which would
 * prevent Angular from initializing an application when opened in a new tab (for example).
 * Second, repeated calls to requestAnimationFrame will execute at the refresh rate of the
 * hardware (~16ms for a 60Hz display). This would cause significant slowdown of tests that
 * are written with several updates and asserts in the form of "update; await stable; assert;".
 * - Both `setTimeout` and `rAF` are able to "coalesce" several events from a single user
 * interaction into a single change detection. Importantly, this reduces view tree traversals when
 * compared to an alternative timing mechanism like `queueMicrotask`, where change detection would
 * then be interleaves between each event.
 *
 * By running change detection after the first of `setTimeout` and `rAF` to execute, we get the
 * best of both worlds.
 */
export function getCallbackScheduler(): (callback: Function) => void {
  // Note: the `getNativeRequestAnimationFrame` is used in the `NgZone` class, but we cannot use the
  // `inject` function. The `NgZone` instance may be created manually, and thus the injection
  // context will be unavailable. This might be enough to check whether `requestAnimationFrame` is
  // available because otherwise, we'll fall back to `setTimeout`.
  const hasRequestAnimationFrame = typeof global['requestAnimationFrame'] === 'function';
  let nativeRequestAnimationFrame =
      hasRequestAnimationFrame ? global['requestAnimationFrame'] : null;
  let nativeSetTimeout = global['setTimeout'];

  if (typeof Zone !== 'undefined') {
    // Note: zone.js sets original implementations on patched APIs behind the
    // `__zone_symbol__OriginalDelegate` key (see `attachOriginToPatched`). Given the following
    // example: `window.requestAnimationFrame.__zone_symbol__OriginalDelegate`; this would return an
    // unpatched implementation of the `requestAnimationFrame`, which isn't intercepted by the
    // Angular zone. We use the unpatched implementation to avoid another change detection when
    // coalescing tasks.
    const ORIGINAL_DELEGATE_SYMBOL = (Zone as any).__symbol__('OriginalDelegate');
    if (nativeRequestAnimationFrame) {
      nativeRequestAnimationFrame =
          (nativeRequestAnimationFrame as any)[ORIGINAL_DELEGATE_SYMBOL] ??
          nativeRequestAnimationFrame;
    }
    nativeSetTimeout = (nativeSetTimeout as any)[ORIGINAL_DELEGATE_SYMBOL] ?? nativeSetTimeout;
  }

  return (callback: Function) => {
    let executeCallback = true;
    nativeSetTimeout(() => {
      if (!executeCallback) {
        return;
      }
      executeCallback = false;
      callback();
    });
    nativeRequestAnimationFrame?.(() => {
      if (!executeCallback) {
        return;
      }
      executeCallback = false;
      callback();
    });
  };
}
