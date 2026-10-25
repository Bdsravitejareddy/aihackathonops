# India state heatmap: sources and reconciliation

## Coverage

The Expansion Intelligence national view serves 36 state/UT polygons. It has 2011 Census rural/urban population and an estimated annual clothing, bedding and footwear expenditure value for 32 polygons. The remaining four polygons are Andhra Pradesh, Telangana, Jammu and Kashmir, and Ladakh. They are gray because the available Census state table reports legacy Andhra Pradesh and legacy Jammu and Kashmir as single units; the state-level source does not support splitting those populations into successor boundaries. The database does not infer population or expenditure for them.

There is no district, city, ward, PIN, household, age-band, income, competitor, footfall, or postal boundary coverage yet. Household and age values are not estimated from population.

## Boundary data

| Field | Record |
| --- | --- |
| Dataset | geoBoundaries India ADM1, simplified GeoJSON |
| Boundary source reported by geoBoundaries | DataMeet India community; Election Commission of India |
| Metadata / download | [ADM1 API metadata](https://www.geoboundaries.org/api/current/gbOpen/IND/ADM1/) · [pinned simplified GeoJSON](https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/IND/ADM1/geoBoundaries-IND-ADM1_simplified.geojson) |
| Reference vintage | 2011; 36 state/UT features |
| Source data update / build | 19 Jan 2023 / 12 Dec 2023, per geoBoundaries metadata |
| Coordinate system | WGS 84 longitude/latitude (EPSG:4326) |
| Licence | The India entry reports **CC BY 2.5 India** for the underlying DataMeet/Election Commission source. The repo retains the pinned source artifact and attribution. |
| Accuracy and use | Simplified cartographic polygons are suitable for the national overview map. They are not cadastral/legal boundaries and should not be used for parcel, postal-service, or precise catchment decisions. |

Survey of India and NIC boundaries were not imported: a reproducible, reusable downloadable feature set could not be obtained with clear redistribution terms. The fallback is attributed to the specific geoBoundaries India metadata; the generic geoBoundaries licence is not substituted for the India entry’s licence.

## Population source and reconciliation

The state rural/urban baseline is Table 2 in the Government of India report [State-wise Rural and Urban Population as per 2001 and 2011 Census](https://nhm.gov.in/images/pdf/monitoring/rhs/rhs-march-2011-tables-final-9-4-2012.pdf). It attributes its 2011 population counts to the Office of the Registrar General & Census Commissioner, India. The [OGD India listing](https://www.data.gov.in/resource/stateut-wise-rural-and-urban-population-census-2011-and-estimation-mid-year-population) describes the matching state/UT dataset under the Government Open Data License India; its catalog currently shows no downloadable resource. The implementation retains the report citation and does not claim that unpublished microdata was acquired.

The 35 source rows reconcile as follows:

| Census 2011 total | Rural | Urban |
| ---: | ---: | ---: |
| 1,210,193,422 | 833,087,662 | 377,105,760 |

The 32 mapped state/UT polygons contain 1,112,978,963 people in the source crosswalk. The omitted 97,214,459 are the legacy Andhra Pradesh (84,665,533) and Jammu and Kashmir (12,548,926) totals. Dadra and Nagar Haveli and Daman and Diu are combined by adding their two 2011 Census rows because the map has one corresponding combined UT polygon. This preserves the full Census source totals without duplicating or area-allocating people.

The population is a historical 2011 observation. It is not labelled current or projected. State density is derived as that population divided by the loaded boundary’s geodesic area; boundary generalisation and the mixed source vintages add uncertainty.

## Clothing and footwear expenditure

MoSPI HCES 2023–24, NSS Report No. 592, Statements **3R** and **3U**, supplies rural and urban state/UT values for rows 28 (clothing and bedding) and 29 (footwear). The survey period is Aug 2023–Jul 2024; the report was released 31 Jan 2025. The source is the [official MoSPI report](https://mospi.gov.in/sites/default/files/publication_reports/Final_Report_HCES_2023-24L.pdf) and [MoSPI e-Sankhyiki HCES catalog](https://esankhyiki.mospi.gov.in/catalogue-main/catalogue?product=HCES). The extracted file stores all 36 state/UTs, both sectors, table statement and report page. The benchmark catalog contains sector-level component and combined values. No-imputation estimates are used; clothing and bedding excludes tailoring charges.

For a compatible Census state/UT, the map computes:

```text
monthly spend/person = (Census rural population × HCES rural spend
                        + Census urban population × HCES urban spend)
                       / Census total population

annual clothing/bedding/footwear expenditure
  = Census 2011 total population × weighted monthly HCES spend/person × 12
```

This deliberately does not apply urban spending to every resident. However, it combines **Census 2011 population** with **HCES 2023–24 expenditure** because a compatible current population projection was not verified for this import. It is a low-confidence, mixed-vintage market expenditure estimate, not actual apparel-store revenue, franchise sales, or a validated current TAM. The map exposes both sources, years, method and warning. No PIN-level income-proportionality adjustment is possible from these state inputs.

## Four checked locations

These values are reproducible from `data/india-geography/india-state-features.geojson` and the PostGIS map API. Annual amounts are rupees per year.

| State/UT | Census 2011 population | Weighted HCES spend (₹/person/month) | Estimated annual clothing, bedding & footwear expenditure |
| --- | ---: | ---: | ---: |
| Karnataka | 61,130,704 | 312.15 | ₹228,979,787,945 |
| Maharashtra | 112,372,972 | 328.26 | ₹442,644,993,272 |
| Tamil Nadu | 72,138,958 | 336.96 | ₹291,693,600,101 |
| Delhi | 16,753,235 | 443.79 | ₹89,219,677,754 |

The sums were checked against the source rural/urban counts. State-specific HCES values remain separate until weighted using the corresponding rural/urban Census population. These totals are not store revenue. Store sales, capture rate, payback, and ROI require separate location and investment assumptions and are not inferred from the heatmap.

## Reproducible checks

- `node scripts/assemble-india-state-data.cjs` verifies the 36-feature boundary file, Census source totals, all 36 HCES records, state matching, and population conservation, then assembles the sourced state feature artifact and manifest.
- `node scripts/build-hces-benchmarks.cjs` rebuilds the state-sector benchmark catalog from the extracted HCES rows.
- `npm run validate:geography` checks the manifest checksums, polygon geometry, feature count and mapped population total.
- `npm run ingest:geography` produces an immutable versioned snapshot; `npm run db:init` applies the additive schema, seeds the Neon catalog and imports geometries.
- The live API was checked for 36 state features with geometry, 32 nonempty annual expenditure values, four explicit missing geographies, a fixed national legend and source warnings. PostGIS validation found 36 valid EPSG:4326 geometries and a GiST geometry index.

`data/india-geography/manifest.json` records source URLs, reference periods, licences/terms, checksums, feature counts and remaining data gaps. District and PIN enrichment requires a verified source and a defensible Census crosswalk before any finer values can be shown.
