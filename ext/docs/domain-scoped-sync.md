# Domain-scoped synchronization

## Domain selection

Sync Domain Keyword is the only domain selection field. Enter one hostname per
line, such as `qq.com` or `jd.com`. Whitespace and empty lines are ignored, domains
are lowercased, and duplicate entries are removed. Leading and trailing dots are
removed. URLs, wildcard patterns, and arbitrary substring matching are not supported.

Cookie uploads call `browser.cookies.getAll({ domain, partitionKey: {} })` for each
configured domain. The `domain` filter includes the domain itself and its
subdomains, without reading cookies for unrelated sites first. An empty or invalid
domain list skips the upload without querying cookies or contacting the server.
The former blacklist is no longer used.

Cookie downloads retain the server-provided cookie restoration behavior. The domain
list controls Local Storage collection and restoration in both modes.

## Background-owned Local Storage

There is no persistent content-script entrypoint or automatic injection on every
website. The background listens for completed tab loads, checks the saved mode,
domain list, and Local Storage setting, and uses `browser.scripting.executeScript`
only for matching HTTP(S) tabs.

Page Local Storage cannot be accessed directly from a background service worker.
The injected function only reads or writes the page's Local Storage. Configuration,
extension storage, synchronization, and pending restore cleanup stay in the
background. The manifest therefore requests the `scripting` permission.

Manual synchronization and connection tests are sent from the popup to the
background through runtime messaging. Uploads refresh snapshots from matching
completed tabs before encrypting the payload. Downloads stage matching Local
Storage data and restore it into already loaded tabs or on their next completed
load. Pending data is removed only after a successful write. Failed or navigated
tabs leave pending data available for a later attempt.

Snapshots continue to use `LS-<hostname>` keys for compatibility. Closed sites use
their most recent stored snapshot; the extension does not open tabs to collect
Local Storage. Matching is hostname-boundary based: `example.com` includes
`app.example.com`, but not `notexample.com` or `example.com.other.test`.

## API references

- [Chrome cookies API](https://developer.chrome.com/docs/extensions/reference/api/cookies)
- [Chrome content scripts and function injection](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Chrome service worker events](https://developer.chrome.com/docs/extensions/get-started/tutorial/service-worker-events)
