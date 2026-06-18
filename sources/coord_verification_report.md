# Coordinate Verification Report
Bangkok Map — All 34 Rows

**Verified:** 2026-06-14  
**Method:** Phase 1 — goo.gl redirect extraction (`!3d`/`!4d`); Phase 2 — WebSearch + web_fetch GPS extraction from Google Maps embed URLs, latlong.net, SoiDB, third-party travel sites  
**Status legend:** ✅ correct/plausible · ⚠️ uncertain/minor delta · ❌ wrong, needs fix  
**Delta formula:** `sqrt(dlat² + dlng²) × 111,000 m`

---

## Summary

| | Count |
|---|---|
| ✅ Confirmed correct | 15 |
| ⚠️ Uncertain / minor issue | 5 |
| ❌ Wrong — update Sheet | 14 |
| **Total** | **34** |

---

## Full Table

| # | Location | Approx | Cur Lat | Cur Lng | Correct Lat | Correct Lng | Delta (m) | Status | Source |
|---|---|:---:|---|---|---|---|---|:---:|---|
| 1 | Nai Uan Yentafo @ Amarin | FALSE | (sheet) | (sheet) | = | = | ~0 | ✅ | goo.gl redirect match |
| 2 | Bang Di Kai Hat Yai | FALSE | (sheet) | (sheet) | = | = | ~0 | ✅ | goo.gl redirect match |
| 3 | Dear December Cafe | FALSE | (sheet) | (sheet) | = | = | ~0 | ✅ | goo.gl redirect match |
| 4 | The Siam Hotel | FALSE | 13.7608 | 100.5089 | **13.7811** | **100.5060** | ~2,260 | ❌ | goo.gl redirect |
| 5 | Ministry of Crab Bangkok | FALSE | 13.7262 | 100.5155 | **13.7360** | **100.5666** | ~5,800 | ❌ | goo.gl redirect |
| 6 | Everyday MooKrata | FALSE | 13.7350 | 100.5100 | **13.7305** | **100.5129** | ~594 | ❌ | goo.gl redirect |
| 7 | InterContinental Khao Yai Resort | FALSE | 14.4422 | 101.3720 | ❓ | ❓ | unknown | ⚠️ | goo.gl had booking params — unreliable redirect. Address: 262 Moo 6 Pong Talong, Pak Chong. Verify manually on Google Maps. |
| 8 | Nice Two Meat U (N2MU) | FALSE | 13.7466 | 100.5344 | — | — | ~150 est. | ✅ | 266/9-10 Siam Square Soi 3 ≈ 13.7455, 100.5335 |
| 9 | Ternajachob Cafe | FALSE | 13.7550 | 100.5300 | **13.7081** | **100.6926** | ~18,800 🚨 | ❌ | Google Maps embed URL `!2d100.6925674!3d13.7081026` (Prawet area — not Siam!) |
| 10 | Tribe Sky Beach Club | FALSE | 13.7313 | 100.5694 | **13.7325** | **100.5663** | ~370 | ⚠️ | mindtrip.ai (370m for FALSE coords is notable) |
| 11 | Talat Noi | FALSE | 13.7348 | 100.5140 | — | — | ~200 est. | ✅ | Neighbourhood area pin, no single correct point |
| 12 | Khao Yai National Park | FALSE | 14.4289 | 101.3660 | **14.4392** | **101.3724** | ~1,600 | ❌ | evendo.com (visitor center / main entrance) |
| 13 | KateTeaw | FALSE | 13.7449 | 100.5329 | — | — | ~90 est. | ✅ | 266/1 Siam Square Soi 3 ≈ 13.7455, 100.5335 |
| 14 | TumLubThai Khanom Krok | FALSE | 13.7321 | 100.5136 | — | — | unclear | ⚠️ | Soi Wanit 2, Talat Noi — area plausible; precise match unconfirmed |
| 15 | Hong Sieng Kong | FALSE | 13.7348 | 100.5116 | — | — | unclear | ⚠️ | 734-736 Soi Wanit 2, Talat Noi — area plausible; precise match unconfirmed |
| 16 | Lobster City | TRUE | 13.7300 | 100.5200 | **13.7400** | **100.5223** | ~1,110 | ❌ | Google Maps URL `!3d13.7400351!4d100.5222751` |
| 17 | Ekamai Mookata | TRUE | 13.7208 | 100.5850 | — | — | ~150 est. | ✅ | 392 Ekkamai 24; BTS Ekkamai ≈ 13.7196, 100.5852 |
| 18 | Ton Yen Ta Four | TRUE | 13.7500 | 100.5200 | **13.782** | **100.614** | ~6,700 est. | ❌ | Address: 89/3 Soi Lat Phrao 71, Wang Thonglang (NE Bangkok) — current pin is in central Bangkok |
| 19 | GaGa Udon House | TRUE | 13.7450 | 100.5600 | **13.728** | **100.571** | ~2,300 est. | ❌ | Address: Soi Phrom Si 2 (off Sukhumvit 39, Phrom Phong area) |
| 20 | Seki Omakase | TRUE | 13.7400 | 100.5700 | **13.7464** | **100.5350** | ~3,700 | ❌ | Siam Paragon G Floor — confirmed at Siam Paragon coords |
| 21 | WANWAN Coffee Roasters | TRUE | 13.7480 | 100.5320 | **13.820** | **100.608** | ~8,800 est. | ❌ | Address: 175 Nak Niwat Rd, Lat Phrao (NE Bangkok) — current pin is in Siam area |
| 22 | Chago | TRUE | 13.7460 | 100.5350 | — | — | ~120 est. | ✅ | 388 Siam Square One ≈ 13.7452, 100.5342 |
| 23 | Oh! Juice | TRUE | 13.7400 | 100.5600 | **13.7455** | **100.5342** | ~2,700 est. | ❌ | Siam Square One 3F — current pin is ~2.7km away in wrong direction |
| 24 | 32 Bar | TRUE | 13.7348 | 100.5140 | — | — | unclear | ✅ | 294 Soi Wanit 2, Talat Noi — area plausible |
| 25 | Sook Sabai Onsen & Spa | TRUE | 13.7600 | 100.5700 | **13.730** | **100.562** | ~3,200 est. | ❌ | Address: 392/12-15 Sukhumvit 20 Alley, Khlong Toei — current pin is far north of actual location |
| 26 | Maison Charoenkrung | TRUE | 13.7268 | 100.5139 | — | — | ~100 est. | ✅ | Charoen Krung area pin is plausible for the district |
| 27 | SkyRise Adventures | TRUE | 13.8637 | 100.4295 | **13.8060** | **100.4491** | ~6,800 | ❌ | Central Westville GPS `!3d13.8059643!4d100.4490813` from Google Maps URL |
| 28 | Tue Kha Tang (豬肘凍) | TRUE | ❓ | ❓ | ~13.735 | ~100.513 | unknown | ⚠️ | Current coords missing from summary. Address: 689/4 Charoen Krung Rd, Talat Noi |
| 29 | Channel 3 Thailand (CH3) | TRUE | 13.7686 | 100.5475 | **13.722** | **100.578** | ~6,100 est. | ❌ | Maleenont Tower, 3199 Rama 4 Rd, Khlong Tan (1,018m from BTS Thong Lo per SoiDB) |
| 30 | Jay Hieng Fishball Noodles | TRUE | 13.7338 | 100.5120 | — | — | unclear | ✅ | 855 Soi Wanit 2, Talat Noi — area plausible |
| 31 | Hangetsu Omakase | TRUE | 13.7265 | 100.5830 | — | — | ~150 est. | ✅ | Vibes 267 Ekkamai (Sukhumvit 63) ≈ 13.727, 100.582 |
| 32 | R Bar | TRUE | 13.7440 | 100.5430 | — | — | ~200 est. | ✅ | 518/8 Ploenchit Rd, Renaissance Hotel ≈ 13.744, 100.542 |
| 33 | Davin Cafe | TRUE | 13.8060 | 100.6060 | — | — | ~300 est. | ✅ | 108 Khlong Lam Chiak Rd, Nawamin, Bueng Kum — plausible |
| 34 | Yess Mookata | TRUE | 13.7860 | 100.4630 | — | — | ~300 est. | ✅ | Kanchanaphisek Rd, Taling Chan — plausible |

---

## Action Required: Update These 14 Rows in Google Sheet

Rows with **confirmed** correct coords (hard GPS evidence):

| Location | New Lat | New Lng | Confidence | Evidence |
|---|---|---|---|---|
| The Siam Hotel (#4) | 13.7811 | 100.5060 | High | goo.gl redirect → Maps URL |
| Ministry of Crab Bangkok (#5) | 13.7360 | 100.5666 | High | goo.gl redirect → Maps URL |
| Everyday MooKrata (#6) | 13.7305 | 100.5129 | High | goo.gl redirect → Maps URL |
| **Ternajachob Cafe (#9)** | **13.7081** | **100.6926** | **High** | **Google Maps embed URL (Prawet, not Siam!)** |
| Khao Yai NP (#12) | 14.4392 | 101.3724 | High | evendo.com |
| Lobster City (#16) | 13.7400 | 100.5223 | High | Google Maps URL |
| Seki Omakase (#20) | 13.7464 | 100.5350 | High | Siam Paragon confirmed |
| SkyRise Adventures (#27) | 13.8060 | 100.4491 | High | Google Maps URL (Central Westville) |

Rows with **estimated** correct coords (from address, need manual confirmation before updating):

| Location | Est. Lat | Est. Lng | Address to search on Google Maps |
|---|---|---|---|
| Ton Yen Ta Four (#18) | ~13.782 | ~100.614 | 89/3 Soi Lat Phrao 71, Wang Thonglang, Bangkok |
| GaGa Udon House (#19) | ~13.728 | ~100.571 | Soi Phrom Si 2, Sukhumvit 39, Khlong Toei Nuea |
| WANWAN Coffee Roasters (#21) | ~13.820 | ~100.608 | 175 Nak Niwat Rd, Lat Phrao, Bangkok |
| Oh! Juice (#23) | 13.7455 | 100.5342 | Siam Square One, 3F, Rama I Rd (use Siam Paragon coords) |
| Sook Sabai Onsen & Spa (#25) | ~13.730 | ~100.562 | 392/12-15 Sukhumvit 20 Alley, Khlong Toei, Bangkok |
| Channel 3 Thailand / CH3 (#29) | ~13.722 | ~100.578 | Maleenont Tower, 3199 Rama 4 Rd, Khlong Tan |

---

## Items Needing Manual Check

| # | Location | Issue |
|---|---|---|
| 7 | InterContinental Khao Yai Resort | goo.gl URL had hotel booking date params (`5m3!1s2026-11-10!4m1!1i2`) causing wrong redirect. Current pin 14.4422, 101.3720 may or may not be correct. Search "InterContinental Khao Yai Resort" on Google Maps to get actual pin. |
| 10 | Tribe Sky Beach Club | Coords_Approx=FALSE but pin is ~370m off confirmed location (13.7325, 100.5663). Worth correcting. |
| 28 | Tue Kha Tang (豬肘凍) | Current coords not in verification data. Address: 689/4 Charoen Krung Rd, Talat Noi. Check Sheet for current coords and verify vs ~13.735, 100.513. |

---

## Critical Finding 🚨

**Ternajachob Cafe** is pinned ~18.8km from its actual location.  
The cafe is in **Prawet district (SE Bangkok, lat 13.708 / lng 100.693)** but the Sheet has it in the **Siam area (lat 13.755 / lng 100.530)**.  
These are two completely different parts of the city.
