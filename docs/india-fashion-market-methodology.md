# India fashion market intelligence methodology

**Model version:** 1.0.0 (provisional screening model)  
**Status:** Exploratory until local catchment, income proxy, competition, traffic, and store economics are supplied and checked.

## Evidence policy

The application labels each input as official observed data, official survey estimate, derived/modelled estimate, assumption, or unavailable. A six-digit PIN passes syntax validation only; the India Post directory has not been ingested, so membership and PIN boundaries are unverified. A PIN is not treated as a Census ward or as a single income group.

The source inventory is in [`data/india-market-sources.json`](../data/india-market-sources.json), with its checked-in observations in [`data/india-market-benchmarks.json`](../data/india-market-benchmarks.json). The values below use HCES Report 592, reference period August 2023–July 2024, released 31 January 2025. They are monthly per-capita survey estimates for Karnataka state rural/urban sectors, not PIN estimates or branded apparel sales:

| Sector | Clothing and bedding | Footwear | Combined benchmark |
|---|---:|---:|---:|
| Rural, without imputation | ₹231.22 | ₹41.95 | ₹273.17/person/month |
| Urban, without imputation | ₹315.29 | ₹58.93 | ₹374.22/person/month |
| Urban, with imputation | ₹317.61 | ₹59.53 | Components reported separately |

Clothing and bedding excludes tailoring. Do not compare imputed and non-imputed series as though they were identical. The state-sector estimate is a fallback benchmark, not a city-specific observation. Source: [MoSPI HCES 2023–24 Report No. 592](https://mospi.gov.in/sites/default/files/publication_reports/Final_Report_HCES_2023-24L.pdf), Statements 3R/3U and 10U.

The latest usable Census town/ward Population Finder and PCA evidence is 2011. Bengaluru BBMP (M Corp. + OG) is 8,495,492 in the PCA-TV catalog; Mysore (M Corp. + OG) is 920,550 in its District Census Handbook. Raichur CMC is included as a geographic comparison, but its numeric population is left unavailable pending extraction and independent verification from the official PCA-TV workbook. These are administrative town totals, not up-to-date store catchments. See the [Census Population Finder](https://censusindia.gov.in/census.website/en/data/population-finder), [Bengaluru PCA-TV](https://censusindia.gov.in/nada/index.php/catalog/6763/), [Mysore District Census Handbook](https://censusindia.gov.in/nada/index.php/catalog/626/download/2152/DH_2011_2923_PART_A_DCHB_MYSORE.pdf), and [Raichur PCA-TV](https://censusindia.gov.in/nada/index.php/catalog/6750).

## Income-adjusted apparel spend

For a like-for-like monthly per-capita income or purchasing-power proxy:

`C_pin = C_region × (I_pin / I_region)^e`

The default elasticity is `e = 1.0` (linear proportionality); sensitivity values are `0.5`, `0.75`, `1.0`, and `1.25`. Example using an **illustrative assumption only**: if regional apparel spend is ₹1,200/person/month, the regional income proxy is ₹40,000/person/month, and the PIN proxy is ₹30,000/person/month, then at elasticity 1.0 estimated spend is `₹1,200 × (30,000/40,000) = ₹900/person/month`. These figures are arithmetic examples, not Indian market observations. Household income cannot be compared directly with per-capita expenditure; convert units consistently first. If either proxy or a justified regional benchmark is missing, the estimate is unavailable.

The PIN-level income proxy is not currently populated from official data. District deposits/credit are not household income and are not automatically allocated to PINs. HCES is a survey estimate, and a valid local estimate would require microdata weights, sample adequacy checks, geography compatibility and a documented allocation model.

## TAM, SAM and SOM

`TAM = catchment population × monthly per-capita category spend × 12`

`SAM = TAM × category relevance × brand/price fit × geographic accessibility`

`SOM = SAM × defensible market capture`

Each factor is applied once. Category/segment shares and accessibility must be supported by measured inputs or explicitly identified assumptions. The application does not infer a PIN population from a city total. For a safe numeric TAM, provide a validated catchment population and a compatible spend estimate; otherwise values remain unavailable.

## Footfall and store economics

Passing pedestrian traffic, store visits, unique shoppers and transactions are distinct. Where the user provides monthly passing traffic and an entry rate, the scenario estimates visits; conversion and average order value estimate transactions and revenue. The current scenario engine does not claim measured traffic. Visit-based revenue and the market-spend TAM/SAM/SOM estimate are separate methods and should be reconciled by an analyst.

Monthly break-even revenue is fixed monthly cost divided by gross margin less royalty rate. Break-even transactions divide that revenue by AOV and contribution margin. Required annual capture is break-even revenue × 12 divided by SAM. Forecast cash flows include a configurable sales ramp, nominal sales growth, inflation adjustment, three scenario factors, initial investment and working capital. NPV discounts monthly operating cash flows; IRR is annualized from monthly cash flows. Taxes, debt, terminal value, inventory working-capital timing, rent escalators, and replenishment cash are not modeled yet. Payback is the first month cumulative operating cash flow recovers initial investment plus working capital.

## Market score

The standalone Market Viability Score uses provisional weights: addressable demand 25%, purchasing power/target demographics 20%, competition/saturation 20%, accessibility/footfall 15%, financial feasibility 15%, and future growth 5%. Each supplied component is on a 0–100 scale. Missing evidence makes the aggregate incomplete; its weight is not redistributed. Negative downside cash flow or critical evidence gaps gate the recommendation. The score is not an industry standard, does not alter applicant eligibility, and needs calibration against real outlet results before operational use.

## Expansion Intelligence map and geographic coverage

The dedicated Expansion Intelligence tab uses locally bundled MapLibre GL JS and fixed national color thresholds. It requests one child level at a time and does not fetch PIN polygons at national zoom. The map API reads versioned geography features from the Neon `market_geographies` and `market_geo_relationships` tables, stores geometries in PostGIS, and returns source provenance with each metric. An area with no compatible value is shown as missing/gray. Selecting or searching an area requests its detail record; comparisons are limited to four geographies. Applying a scenario sends user assumptions to the server and returns scenario-tagged results separately from applicant scoring.

**Current artifact coverage is zero:** no government boundary features, Census demographic rows, PIN crosswalks, PIN income proxies, or catchment population allocations were ingested. The official OGD India PIN boundary catalog displayed no downloadable resource during this run. The Census PCA workbook endpoint returned an HTTP failure from its official mirror. Survey of India lists administrative boundary products, but its reuse policy requires permission not obtained for offline redistribution. NIC's BharatMapService metadata confirms state/district boundary layers, Census 2011 codes and GeoJSON query support, but the feature query timed out and no geometry was received. These source records and gaps are in [`data/india-geography/manifest.json`](../data/india-geography/manifest.json).

The official Census Population Finder advertises 85 PCA indicators down to district, subdistrict, town, village and ward, including households, sex and selected age groups; this is a source inventory, not proof those values are bundled in this application. Census reference values remain dated 2011. The NIC BharatMapService describes its national state/district layer as updated through October 2017, with 36 states and 717 districts and post-2011 district codes. Neither PIN-level demand nor 2026 population is observed here. [Census Population Finder](https://censusindia.gov.in/census.website/en/data/population-finder), [NIC BharatMapService metadata](https://mapservice.gov.in/gismapservice/rest/services/BharatMapService/Admin_Boundary_District/MapServer), [OGD India PIN boundary catalog](https://www.data.gov.in/catalog/all-india-pincode-boundary-geo-json), [Survey of India boundary catalog](https://surveyofindia.gov.in/pages/administrative-boundary-data-base-abdb-).

The backend areal interpolation helper is available for future validated intersecting parent/child polygons. It normalizes intersection area within each source parent, conserves that parent total, marks allocations as derived estimates with high uncertainty, and returns null when the source count or valid intersections are missing. It has not been applied to real PINs in this release. Population density requires validated population and PostGIS area. TAM requires population plus compatible apparel spend. SAM additionally needs documented segment and access factors. SOM and expected revenue require an explicit capture assumption; they remain scenario projections, never observed sales. Income elasticity defaults to 1.0 and is adjustable from 0.5 to 1.25; absent local and regional income/spend benchmarks leave adjusted spend unavailable. When the user supplies all required cost, margin, working capital, pedestrian traffic, entry, conversion, AOV, ramp and discount assumptions, the map scenario route invokes the existing `projectStoreEconomics` engine for conservative, base and optimistic cases. Missing inputs leave ROI and payback unavailable.

The map is an integrated, tested application feature with an empty sourced geometry catalog. It cannot yet support a real India-wide visual expansion analysis. The data pipeline deliberately emits a zero-coverage snapshot instead of drawing illustrative state, district, city or PIN shapes.

## Three evidence checks

The bundled comparison fixture uses Bengaluru BBMP, Mysore M Corp. + OG and Raichur CMC, all at Census-town geography. It deliberately contains no PIN population, income proxy, competitors, current demographics, footfall or store financial inputs. Bengaluru and Mysore population are 2011 official town totals; Raichur's exact total remains null pending official-table extraction. Therefore these are data-coverage checks, not three investment evaluations and not model accuracy validation.

| Case | Verified input | Decision status |
|---|---|---|
| Bengaluru metro | BBMP 2011 population 8,495,492 | Exploratory; population alone cannot establish demand or viability |
| Mysore tier 2 | Town 2011 population 920,550 | Exploratory; population alone cannot establish demand or viability |
| Raichur smaller city | Official CMC identifier verified; population not yet extracted | Incomplete; no numeric market sizing |

## Remaining data needs for a Mesa decision

Provide the exact store PIN/address, verified India Post lookup and geographic boundary/crosswalk, current catchment population allocation, target segment, local income proxy or representative survey, relevant category/price fit, competitor locations, observed pedestrian counts or comparable-store visits/conversion/AOV, rent and full startup/working capital assumptions, plus comparable outlet financials. For age and household distributions, ingest official Census PCA/C-14 data with vintage and geography. Census 2011 cannot silently be presented as current. No official PIN-level income, apparel spend or footfall is supplied in this release.

No out-of-sample validation has been performed. Do not interpret scenario outputs as a forecast accuracy claim or an unconditional investment recommendation.
