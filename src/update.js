/* ---------------------------------------------------------------------------
   Update check.

   The service worker precaches everything so the app works offline, which also
   means a deployed change is invisible until the worker is replaced. The
   plugin's `autoUpdate` did that silently, and silently meant mid-round: the
   page could reload out from under him between two cards.

   So `registerType` is `prompt` (see vite.config.js) — a new worker installs
   and then waits. This module asks the browser to look for one whenever the
   home screen renders, and reports back so the home screen can offer it as a
   button he taps deliberately, between rounds rather than during one.

   Everything here degrades to "no update available": no service worker support,
   a dev server without one, or a phone that is offline — all end up with
   `isUpdateReady()` false and nothing rendered.
   --------------------------------------------------------------------------- */

import { registerSW } from 'virtual:pwa-register'

let ready = false
let notify = () => {}
let registration = null

registerSW({
  immediate: true,
  onNeedRefresh() {
    ready = true
    notify()
  },
  onRegisteredSW(_url, r) {
    registration = r ?? null
  },
})

/* The worker that is installed and waiting to take over, if there is one.
   Read fresh each time: the registration moves it between `installing` and
   `waiting` as it settles. */
function pendingWorker() {
  return registration?.waiting ?? registration?.installing ?? null
}

/** Is a new version installed and waiting? */
export function isUpdateReady() {
  return ready
}

/** Called when an update turns up after the home screen has already rendered. */
export function onUpdateReady(fn) {
  notify = fn
}

/* Ask the browser to re-fetch the worker. Offline this rejects, which is the
   ordinary case on his phone and means exactly what it looks like: no update
   to be found. Nothing to report, so it is swallowed. */
export function checkForUpdate() {
  registration?.update().catch(() => {})
}

/* Activate the waiting worker and reload onto it.

   The generated worker never calls `clients.claim()`, so activating it does
   not make it take over this page and no `controllerchange` fires — which is
   what the plugin's own reload waits for. Watching the worker reach
   `activated` and reloading from here is what actually lands the update; the
   reload's navigation request is served by the new active worker.

   Two guards: `once` so a worker that bounces through states cannot reload
   twice, and a plain reload when there is nothing waiting, which is the right
   answer anyway for a page that turns out not to be controlled. */
export function applyUpdate() {
  const pending = pendingWorker()
  if (!pending) {
    window.location.reload()
    return
  }
  pending.addEventListener(
    'statechange',
    function onStateChange() {
      if (pending.state === 'activated') {
        pending.removeEventListener('statechange', onStateChange)
        window.location.reload()
      }
    }
  )
  pending.postMessage({ type: 'SKIP_WAITING' })
}
