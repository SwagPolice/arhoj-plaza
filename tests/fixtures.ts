import { DRIPPY, NISSE, SHROOM, type Golden } from './recipes';

/*
 * Golden share codes: real codes made by past versions of the game, with the character each must open as.
 * Never edit or delete these. When you add a feature, make a character that uses it, press Share,
 * and add its code here together with the character you expect (see tests/recipes.ts).
 */
export const GOLDEN: { made: string; code: string; expected: Golden }[] = [
  { made: '2026-10-13, recipe v1', code: 'arhoj1.hZHBSsQwEIbf5fcalm12qzVXQTyJ4FE8zDaTNpAmpdNV6tJ3l9RdKqJ4nH9m8n1kTniDKRQidQyDRy_CUBBmC1Po3b5UOCQ7waBpk4xQaNk37QhTbLTCu7djC7Pd3CrUgaaHc3O70Voh0MSDwLycUKeQjgMMrtyN23OGOB-9tPnlkEQmKPQ0jjxEGPSBfFyTu3XbOesqKLBtsnEdmPLgwFQvIuWsvtNstau0-4dm0yi_wi6qf8Gu9fyq0AQSgcnYgZc9fago7-Xg_gKWFLzNIfXL0LYivf-qn36qrNlqo11ZHkrMCjyxwCD1nG144vXbd-USPPsPPp8oVz3VPja5Xyh06Zhvhphidux5kBQp-DFfuabQYf4E', expected: NISSE },
  { made: '2026-10-13, recipe v1', code: 'arhoj1.jZLNbsMgEIRfpZpeURS7dn64tqp6rNRj1cMa1jYKsRGQRDTKu1ckbeLcemNmd_kGsUfsIQuBgbYMiRdvnEsPJQQCs4Zcr5aLuhJoRp0g0bC1EOjZdH2ELGbzWuBgdOyzKASUpfT2W53PilrAUmIfID-PUKMddx4Sj2rdLLiCQGsGE3pIBIpmgICjGNkP2XGsNpZv3vN1vKzKp5IgwLrLsQ-0TxDwTKrP3PokprSyreumntI6O4aQ7nHRM23Cf3DaGxemvOqex3PSFU15W45krVF3RGdp-uQbr21b3a5uvJY0T3FFffoS6CyFAJnBPnc90prnKo9l4_UP3foxRNbZJpfbllTRUl30-zVMZ00-3tmTRGWzIsZJgBMHSETjz3dy4tt3r876w3xzVuuLcqTM0GVjIbAdd3lVcBl27MM4kDUx71boE04_', expected: DRIPPY },
  { made: '2026-10-13, recipe v1', code: 'arhoj1.VZBBa8MwDIX_y-vVlKRrRurroOw46HHsoDhyYnDsYDsdXul_H862ht2kpyfp491whawFHE0MicuVppkhEJl7yONBoPN9hsS0xDF4P0FgZDOMCbLePwl8mj6NkNW-bQSUpfz6O632BwFLmUOEfL9BeeuXAIkdnbhSLQS0cSaOkBisjzFDYKaUODhIzJaM25SXx7bWutdlm_uhICvLVIyBSa0gzf1DYLAUI2R5G4prp07dMx8hVuH891gHHxP3RaZ5vX7oWuKf_u0Bo7zTnJL5p29ItW6paXAX4Myx-IOPcT3LmbdAmrW_mC9eMy_1TMq4AbISmPxSkoTzrgDMHKJ3ZE0q8Xd-cSrj_g0', expected: SHROOM },
];
