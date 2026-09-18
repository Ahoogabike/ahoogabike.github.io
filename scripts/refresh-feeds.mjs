# ─────────────────────────────────────────────────────────────────────
#  Refresh the planning feeds before the morning parts email.
#
#  The three planning pages compute in the browser and publish to the
#  shared store. Until this job existed, somebody had to open all three
#  by hand or the 07:00 email went out on stale numbers — looking
#  exactly as confident as a fresh one.
#
#  Runs 06:30 UTC on weekdays, half an hour before parts-watch sends.
#  Also runnable by hand from the Actions tab.
# ─────────────────────────────────────────────────────────────────────
name: Refresh planning feeds
 
on:
  schedule:
    - cron: '30 6 * * 1-5'      # 08:30 Brussels in summer, 07:30 in winter
  workflow_dispatch:            # the "Run workflow" button
 
concurrency:
  group: refresh-feeds
  cancel-in-progress: false     # never run two at once against one store
 
jobs:
  refresh:
    runs-on: ubuntu-latest
    timeout-minutes: 60
 
    steps:
      - uses: actions/checkout@v4
 
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
 
      - name: Install Playwright + Chromium
        run: |
          npm install --no-save playwright@1
          npx playwright install --with-deps chromium
 
      - name: Open the three pages and wait for each feed to publish
        env:
          ODOO_USER: ${{ secrets.ODOO_USER }}
          ODOO_KEY:  ${{ secrets.ODOO_KEY }}
        run: node scripts/refresh-feeds.mjs
 
      # Only on failure, and only screenshots — no page HTML, because the
      # pages hold live Odoo data once loaded.
      # The feeds are fresh and verified at this point, so this is the right moment
      # to send — and it can only happen if the refresh above actually succeeded.
      # That is the staleness guard for free: no fresh data, no email.
      #
      # It also removes two failure modes that between them cost two mornings:
      # a Cloudflare cron that may never have registered, and a Worker calling
      # another Worker over workers.dev, which returns 404 on this account and
      # fails silently. One scheduler, one place to look.
      - name: Send the morning parts list
        env:
          ADMIN_KEY: ${{ secrets.PARTS_WATCH_ADMIN_KEY }}
        run: |
          set -o pipefail
          echo "Triggering parts-watch /run …"
          code=$(curl -sS -o /tmp/run.json -w '%{http_code}' \
            "https://parts-watch.ahoogahouse-1050-be.workers.dev/run?key=$ADMIN_KEY")
          echo "HTTP $code"
          cat /tmp/run.json; echo
          if [ "$code" != "200" ]; then echo "parts-watch did not accept the request."; exit 1; fi
          grep -q '"sent":true' /tmp/run.json || { echo "parts-watch ran but sent nothing."; exit 1; }
          echo "Sent."
 
      - name: Keep screenshots if a page did not publish
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: failed-pages
          path: failed-*.png
          retention-days: 7
          if-no-files-found: ignore
