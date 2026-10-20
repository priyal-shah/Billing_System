import FormatA from './FormatA';
import FormatB from './FormatB';

/**
 * Bill format registry. Ids must match backend app/bill_formats.py.
 * To add a format: create a component taking { order, shop }, register it here with
 * its @page rule, and add the same id on the backend.
 */
export const BILL_FORMATS = {
  format_a: { id: 'format_a', name: 'Format A – A4 Tax Invoice', component: FormatA, page: '@page { size: A4; margin: 12mm; }' },
  format_b: { id: 'format_b', name: 'Format B – 80mm Receipt', component: FormatB, page: '@page { size: 80mm auto; margin: 3mm; }' },
};
