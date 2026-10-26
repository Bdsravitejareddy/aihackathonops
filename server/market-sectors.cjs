'use strict';

// Sector registry: what a retail sector means for the map, competitor search and scoring.
// Apparel is the built-in default; researched sectors are added at runtime (see the sector research feature).
//
// Profile shape (every number carries evidence in `sources` or is listed in `assumptions`):
//   id, name, description
//   hcesCategories: HCES 2023-24 item groups whose per-capita spend makes up this sector's consumer spend
//   organisedShare, onlineShareOfOrganised: share of category spend through organised / online retail (0-1)
//   osmTags: OpenStreetMap tag filters for observed competitor stores, e.g. [['shop','clothes']]
//   majorBrands: brand names to look for when counting competitors
//   store: per-store format assumptions consumed by the analysis (areaSqFt, revenuePerSqFtYear, ...)
//   scoringWeights: market viability weights (demand, purchasingPower, competition, accessibility, financial, growth; sum 1)
//   partnerRequirements: franchise partner thresholds (minInvestmentLakh, minAreaSqFt, minLaunchMonths, targetLaunchMonths)
//   sources: [{ title, publisher, url, retrievedAt }], assumptions: [keys without a sourced value]

const APPAREL = Object.freeze({
  id: 'apparel', name: 'Apparel & fashion', description: 'Clothing, bedding and footwear retail (built-in sector).',
  hcesCategories: ['clothing & bedding', 'footwear'],
  organisedShare: 0.41, onlineShareOfOrganised: 0.22,
  osmTags: [['shop', 'clothes'], ['shop', 'shoes'], ['shop', 'fashion'], ['shop', 'boutique'], ['shop', 'department_store']],
  majorBrands: ['Zudio', 'Westside', 'Trends', 'Max', 'Pantaloons', 'V-Mart', 'Style Union', 'Lifestyle', 'Shoppers Stop', 'Bata', 'Allen Solly', 'Peter England', 'Van Heusen', 'Biba', 'W', 'FabIndia', 'Manyavar', 'Decathlon', 'H&M', 'Uniqlo'],
  store: null,
  scoringWeights: { demand: 0.25, purchasingPower: 0.20, competition: 0.20, accessibility: 0.15, financial: 0.15, growth: 0.05 },
  partnerRequirements: { minInvestmentLakh: 30, minAreaSqFt: 400, minLaunchMonths: 3, targetLaunchMonths: 6 },
  sources: [{ title: "India's apparel retail market poised to reach US$ 193 billion by FY30: CareEdge", publisher: 'IBEF', url: 'https://www.ibef.org/news/india-s-apparel-retail-market-poised-to-reach-us-193-billion-by-fy30-careedge' }],
  assumptions: ['majorBrands', 'partnerRequirements'],
  builtIn: true
});

function createSectorRegistry({ store = null } = {}) {
  const custom = new Map();
  return {
    defaultId: APPAREL.id,
    async get(id) {
      if (!id || id === APPAREL.id) return APPAREL;
      if (custom.has(id)) return custom.get(id);
      const saved = store ? await store.getSector(id) : null;
      if (saved) custom.set(id, saved);
      return saved || null;
    },
    async list() { return [APPAREL, ...(store ? await store.listSectors() : [...custom.values()])]; },
    remember(profile) { custom.set(profile.id, profile); }
  };
}

module.exports = { APPAREL, createSectorRegistry };
