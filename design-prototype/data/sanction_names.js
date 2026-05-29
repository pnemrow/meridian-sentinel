// Friendly display names for Sayari sanction factor codes + ownership-exposure
// factor codes. Covers every sanctioned_* code that appears across list_1's
// cached data plus the ownership-derived factors the demo narrative refers
// to. Codes not in this map fall back to a humanised version of the raw code
// (replace underscores with spaces + title-case).

window.SANCTION_NAMES = {
  // ── Direct designation factors (sanctioned_*) ──
  "sanctioned":                            "Directly Sanctioned",
  "sanctioned_adjacent":                   "Sanctioned-Adjacent",
  "sanctioned_other":                      "Other Sanctioned List",

  // USA
  "sanctioned_usa_ofac_sdn":               "USA OFAC SDN",
  "sanctioned_usa_ofac_non_sdn":           "USA OFAC Non-SDN",

  // EU
  "sanctioned_eu_sanctions":               "EU Sanctions",
  "sanctioned_eu_dg_fisma_ec":             "EU DG FISMA",
  "sanctioned_eu_ec_sanctions_map":        "EU Council Sanctions Map",
  "sanctioned_eu_ec_regulation":           "EU Council Regulation",
  "sanctioned_eu_ec_regulation_269_2014":  "EU Council Reg 269/2014",
  "sanctioned_eu_ec_regulation_833_2014":  "EU Council Reg 833/2014",

  // UK
  "sanctioned_gbr_fcdo":                   "UK FCDO",
  "sanctioned_gbr_hmt_ofsi":               "UK HMT/OFSI",
  "sanctioned_gbr_ofsi":                   "UK OFSI",

  // Other national regimes
  "sanctioned_can_gac":                    "Canada GAC",
  "sanctioned_che_seco":                   "Switzerland SECO",
  "sanctioned_aus_dfat":                   "Australia DFAT",
  "sanctioned_jpn_mof":                    "Japan MOF",
  "sanctioned_fra_dgt_mefids":             "France DGT MEFIDS",
  "sanctioned_nzl_mfat_rus":               "New Zealand MFAT (Russia)",
  "sanctioned_nzl_russia_sanctions":       "New Zealand Russia Sanctions",
  "sanctioned_ukr_nsdc":                   "Ukraine NSDC",
  "sanctioned_ukr_sfms":                   "Ukraine SFMS",

  // Multilateral
  "sanctioned_un_sc":                      "UN Security Council",

  // ── Ownership-exposure factors (used by the WHY-THIS-ROW banner) ──
  "owned_by_sanctioned_usa_ofac_sdn_entity":  "Owned By OFAC SDN Entity",
  "controlled_by_ofac_sdn":                   "Controlled By OFAC SDN",
  "ofac_50_percent_rule":                     "OFAC 50% Rule",
  "eu_50_percent_rule":                       "EU 50% Rule",
  "uk_50_percent_rule":                       "UK 50% Rule",
  "owned_by_sanctioned_entity":               "Owned By Sanctioned Entity",
  "owner_of_sanctioned_entity":               "Owner Of Sanctioned Entity",
  "owner_of_sanctioned_usa_ofac_sdn_entity":  "Owner Of OFAC SDN Entity",

  // ── PEP / state-owned (shown alongside sanctions chips) ──
  "pep_adjacent":                             "PEP-Adjacent",
  "state_owned":                              "State-Owned",
  "state_owned_rus":                          "Russian State-Owned",
  "state_owned_blr":                          "Belarusian State-Owned",
};

window.sanctionDisplayName = function (code) {
  if (!code) return code;
  if (window.SANCTION_NAMES && window.SANCTION_NAMES[code]) return window.SANCTION_NAMES[code];
  // Fallback: humanise the raw code.
  return String(code).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
};

// Specific reason text for the ⚠ verify chip. Used as both a hover title and
// the body of ConfidenceFlag's popover. Same wording across every surface so
// analysts see consistent copy. Interpolates the actual input + match label
// so the explanation is specific, not generic.
window.buildVerifyReason = function (inputName, matchLabel) {
  return (
    "Match label '" + (matchLabel || '?') + "' shares no lexical tokens (>2 chars) with input '" +
    (inputName || '?') + "'. This is common for acronyms (e.g. 'BMI' → 'Bank Melli Iran') and " +
    "abbreviated company names. Open the resolution cache to confirm this is the intended entity."
  );
};
