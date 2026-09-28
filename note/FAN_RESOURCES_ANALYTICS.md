# 粉絲資源追蹤 / Fan resources tracking

## 定義 / Definition

`fan_resources_open` 在粉絲資源 dialog 成功 `showModal()` 後送出。
桌機入口與手機「更多操作」入口共用同一事件。視窗已開啟時再次呼叫
`open()` 不會重複送出；關閉後重新開啟會再計一次。

`fan_resources_open` is queued after the dialog successfully opens. Desktop
and mobile entry points use the same event. Calling `open()` while the dialog
is already open does not emit another event; closing and reopening does.

`fan_resource_click` 在使用者啟動卡片連結時送出，包含一般點擊、鍵盤與滑鼠
中鍵開啟。卡片文字、關閉與右鍵不計入。這代表點擊外部連結，無法確認
外部網站是否載入成功。既有 GA4 自動外連 `click` 事件可能也會送出，報表
必須篩選此自訂事件，避免混算。

`fan_resource_click` records a link activation (primary/keyboard or middle
click), not a confirmed load on the external website. Card text, dismissal, and
right clicks do not count. Filter reports to this custom event; GA4 enhanced
measurement may separately record an automatic outbound `click` event.

## GTM event matrix

Target container: `GTM-NVNXGP44`. GA4 measurement ID: `G-31MF79LHFM`.

| Event | Event-only parameters | Shared parameters | Exact trigger | GA4 tag | Test action |
| --- | --- | --- | --- | --- | --- |
| `fan_resources_open` | `interaction_source` | `ui_language` | `CE - fan_resources_open` | `GA4 - fan_resources_open` | Open Fan resources on desktop; open through More on mobile; close and reopen |
| `fan_resource_click` | `resource_id`, `link_type`, `interaction_source` | `ui_language` | `CE - fan_resource_click` | `GA4 - fan_resource_click` | Activate each card's website/source links and Fanpage schedule; verify nested text/icons and mobile |

| Parameter key | DLV display name | Data Layer Variable Name | Version | Used by this event |
| --- | --- | --- | --- | --- |
| `interaction_source` | `DLV - interaction_source` | `interaction_source` | 2 | Both events |
| `ui_language` | `DLV - ui_language` | `ui_language` | 2 | Both events |
| `resource_id` | `DLV - resource_id` | `resource_id` | 2 | `fan_resource_click` |
| `link_type` | `DLV - link_type` | `link_type` | 2 | `fan_resource_click` |

The click tag reuses `interaction_source` and `ui_language` and contains exactly
four custom parameters. The open tag continues to contain exactly two.

| `resource_id` | Card / 卡片 |
| --- | --- |
| `lingorm_google_maps` | LingOrm Google Maps |
| `lingorm_fanpage` | LingOrm Fanpage |
| `loism` | LOism |
| `lingorm_news` | LingOrmNews |
| `lingorm_pics` | LingOrm Pics |

`link_type`: `website` (前往網站／地圖清單), `source` (作者來源),
`schedule` (Fanpage 近期行程). `interaction_source` retains the entry point
used to open the dialog; UI language is captured at click time.

Reuse existing matching Version 2 variables. Each production Custom Event
trigger must match its event name exactly with regex disabled. Each GA4 tag
must include only its parameter allowlist, excluding persisted location,
filter, map, or other event data from earlier data-layer events.

`interaction_source`: `desktop_header`, `mobile_menu`, or `unknown` for an
unrecognized/programmatic opener. `ui_language`: `zh` or `en` at open time.

## 報表 / Reporting

在 GA4「事件」報表篩選 `fan_resources_open`，選擇日期範圍：

- 「總使用者」：該期間觸發事件的去重使用者數。
- 「事件計數」：視窗開啟次數，包含同一使用者重新開啟。

Filter the GA4 Events report to `fan_resources_open` for the chosen date range:
Total users counts distinct users who triggered the event; Event count counts
opens, including repeat opens by the same user. Standard GA4 user identification
applies; this is not an exact count of individual people across all devices.

No custom dimension is required to count this event's users or opens. Register
event-scoped custom dimensions for the parameters only if breakdowns by entry
point or UI language are needed and matching definitions do not already exist.

要查看哪些卡片被點擊，註冊事件範圍 `resource_id` 與 `link_type` 自訂維度。
自由形式探索：列為 `resource_id`、`link_type`，值為「總使用者」與
「事件計數」，篩選 `事件名稱` 完全符合 `fan_resource_click`。只看前往
網站／地圖清單時，再篩選 `link_type` 完全符合 `website`。

Register event-scoped `resource_id` and `link_type` dimensions. The Free form
exploration uses these rows, Total users and Event count values, and the exact
filter `Event name = fan_resource_click`. Add `link_type = website` to count
only main website/Maps links. New definitions are not retroactive and may take
24–48 hours to become available in reports.

已保存的探索：[粉絲資源卡片點擊](https://analytics.google.com/analytics/web/?authuser=2#/analysis/a398439811p542286421/edit/BsfLA2RySvqNsAWqAVx1lw)。
分頁「卡片與連結類型」另篩選 `主機名稱 = lingorm-map.netlify.app`，排除
本機與 Deploy Preview 流量，一次顯示 25 列。`resource_id` 對照上方卡片表。
預設為過去 28 天（不含今天）；上線後請調整所需日期範圍。去重使用者
可能點擊多張卡片，因此不能直接把各列人數相加當作總人數。

The saved exploration filters to the production hostname, shows 25 rows, and
uses the default past-28-days range excluding today. Distinct users can appear
in multiple resource/link rows; summing row-level users overcounts the total.

## 驗證與上線 / Verification and rollout

- Unit tests cover desktop/mobile opens, repeated-open suppression, reopening,
  failed `showModal()`, parameter isolation, and browserless execution.
- Container configuration, all-pages Google tag measurement ID, Tag Assistant
  payloads, and GA4 DebugView must be verified before publishing GTM.
- Frontend deployment and GTM publication are both required before this new
  event can measure live usage. Past dialog opens cannot be reconstructed from
  this event.
- Local/Deploy Preview tests use the production GA4 ID unless the container has
  hostname restrictions or test-traffic filtering. Review hostname when reading
  launch metrics so preview and local traffic do not inflate production counts.

### 2026-09-28 audit status

- Workspace `5`: zero pending changes before editing. Saved draft now contains
  exactly six changes: two triggers, two tags, and two variables.
- Published version `4`: 9 tags, 9 triggers, 21 variables.
- Existing `Lingorm Map Usage` Google tag: `G-31MF79LHFM`, triggered by
  `Initialization - All Pages`.
- Existing `DLV - interaction_source` (ID `11`): exact key
  `interaction_source`, Version 2.
- Existing `DLV - ui_language` (ID `5`): exact key `ui_language`, Version 2.
- Frontend implementation: typecheck, 469 unit tests, build, and diff whitespace
  check passed before committing. Frontend deployment remains pending.
- Saved `CE - fan_resources_open` (ID `43`): exact Custom Event name
  `fan_resources_open`, regex disabled.
- Saved `GA4 - fan_resources_open` (ID `44`): `G-31MF79LHFM`, only
  `interaction_source` and `ui_language`, only the matching trigger. No event
  settings variable or ecommerce data. The existing debug regex trigger remains
  unattached and unchanged.
- Tag Assistant Preview on `http://localhost:8888/`: desktop opening in Chinese,
  desktop reopening in English, and mobile opening at 390 × 844 each produced
  one successful `GA4 - fan_resources_open` tag. Three opens produced three
  events; clicking dialog content and closing did not add opens.
- Preview resolved parameters to `desktop_header` / `zh`, `desktop_header` /
  `en`, and `mobile_menu` / `en` respectively. A preceding `location_open`
  did not add persisted location parameters to the new tag.
- GA4 `lingorm-map` property `542286421` DebugView received all three test
  `fan_resources_open` events. The mobile event was inspected and contained
  `interaction_source=mobile_menu`, `ui_language=en`, plus GA4 automatic
  parameters; no location-specific custom parameters appeared.
- Saved click variables: `DLV - resource_id` (ID `45`) and `DLV - link_type`
  (ID `46`), exact keys, both Version 2.
- Saved `CE - fan_resource_click` (ID `47`): exact name, regex disabled.
  `GA4 - fan_resource_click` (ID `48`): the same measurement ID, only
  `resource_id`, `link_type`, `interaction_source`, and `ui_language`, only
  the matching trigger, no event settings variable or ecommerce data.
- Click Preview: all eleven desktop links (five websites, five sources, one
  schedule) each fired exactly one successful click tag with the correct card
  and link type. A twelfth click on the nested schedule text at 390 × 844
  resolved `lingorm_fanpage`, `schedule`, `mobile_menu`, and `zh`.
- After preceding card clicks, the mobile open tag still sent only its two
  allowlisted parameters. Click values did not leak into the open tag.
- DebugView received twelve `fan_resource_click` events. The mobile click
  contained the four expected custom parameter keys, plus GA4 automatic
  parameters. These are local test events, not production usage.
- GA4 custom definition audit: 18 existing event dimensions and 3 custom
  metrics before changes; no duplicate resource/link definitions. Added only
  event-scoped `resource_id` and `link_type` (20 dimensions total). Existing
  `interaction_source` and `ui_language` definitions were reused.
- Saved and reopened the Free form exploration; verified both row dimensions,
  Total users / Event count, exact event and production-hostname filters, and
  tab name. It currently has no production data; new dimensions may require
  processing time.
- GTM publication and frontend deployment remain pending authorization. This
  tracking is not live yet. DebugView events are local tests, not real
  production users.

程式、GTM 草稿與卡片探索報表已完成，桌機、手機、重新開啟與卡片連結
皆通過 Preview，GA4 DebugView 已收到本機測試事件。尚未發佈 GTM 或部署
程式，因此目前不能用測試資料回答正式站有多少人開啟或點擊哪張卡片。

Official references:
[GTM GA4 events](https://support.google.com/tagmanager/answer/13034206),
[GA4 Events report metrics](https://developers.google.com/analytics/devguides/reporting/data/v1/predefined-reports),
[GA4 event-scoped custom dimensions](https://support.google.com/analytics/answer/14240153).
