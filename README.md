# mars-demo-ui

Static UI subcomponent for the **Mars Demo Shop** App Platform app.

## Role in the app

| Concern | Detail |
| --- | --- |
| App Platform type | `static_sites` component named `web` |
| Owned by | This repo |
| Wired from | [`mars-demo-app`](https://github.com/mars-demo-app/mars-demo-app) → `.do/app.yaml` |
| Source dir | `public/` |
| Ingress | `/` (API is mounted at `/api`) |

App Platform serves the built static assets from `public/` using the `html` environment. No Node build step is required.

## Local preview

```bash
cd public
python3 -m http.server 45123
# open http://127.0.0.1:45123
```

API calls go to `/api/*`. Locally that path only works when you reverse-proxy to the API, or when the full app is deployed on App Platform (ingress routes `/api` to the service).

## Contents

- `public/index.html` — shop surface with demo actions
- `public/app.js` — calls health, create/cancel order, email lookup, load tests
- `public/styles.css` — layout
- `public/404.html` — static error document referenced by the app spec

## App Platform fragment

This repo owns its App Platform component config in [`.do/component.yaml`](.do/component.yaml).
The parent [`mars-demo-app`](https://github.com/mars-demo-app/mars-demo-app) tracks this repo as a git submodule and merges fragments into `.do/app.yaml`.

When `.do/**` changes on `main`, workflow `notify-parent-spec` dispatches the parent's `compose-app-spec` workflow (requires secret `PARENT_DISPATCH_TOKEN`).
