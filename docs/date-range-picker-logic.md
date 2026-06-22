# Date Range Picker Logic

This note saves the reusable UPOS date picker behavior used on the sales form.

## Files

- `pyweb/upos/static/date-range-picker.js` - renders the calendar popup and handles presets, month navigation, and date range selection.
- `pyweb/upos/static/date-auto-picker.js` - automatically replaces native `input[type="date"]` fields with the UPOS picker UI.
- `pyweb/upos/templates/base.html` - loads the picker scripts globally.
- `pyweb/upos/templates/home_sales.html` - example usage in the sales form.

## Sales Form Usage

Use one visible date input for the start date and one hidden input for the end date:

```html
<input
  name="date"
  type="date"
  value="{{ today }}"
  data-upos-date-range
  data-upos-date-to="date_to"
/>
<input name="date_to" type="hidden" value="{{ today }}" />
```

`data-upos-date-range` switches the auto picker from single-date mode to range mode.
`data-upos-date-to="date_to"` tells the picker which hidden field stores the end date.

## Behavior

- First day click sets `date` and starts selecting `До`.
- Second day click sets `date_to`.
- If the end date is before the start date, `apply()` swaps them before saving.
- The left calendar shows the start month.
- The right calendar shows the next future month when both selected dates are in the same month.
- The visible summary shows a single date or a range, for example `22.06.2026 - 26.06.2026`.

## Save Payload

On submit, the sales form sends:

- `date` - start date / document date.
- `date_to` - end date.

The server stores both values in the sales document data. The sales journal displays `date_label`, which is either the single date or `date - date_to`.

## Version Bumps

When changing picker behavior, bump cache versions in templates:

```html
date-range-picker.js?v=13
date-auto-picker.js?v=2
```
