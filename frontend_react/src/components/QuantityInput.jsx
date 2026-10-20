import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import { IconButton, InputAdornment, Stack, TextField } from '@mui/material';
import { useEffect, useState } from 'react';
import { isDecimalUnit, qtyStep, quantityError } from '../utils/format';

/**
 * Quantity picker: −/+ buttons for quick changes and a text field for manual entry.
 * Calls onChange(number) only with valid quantities; invalid text shows an error until fixed.
 */
export default function QuantityInput({ value, unit, onChange, size = 'small', disabled, width = 150 }) {
  const [text, setText] = useState(String(value));
  const step = qtyStep(unit);

  // Sync from outside changes, but keep in-progress typing like "1." intact.
  useEffect(() => setText((t) => (Number(t) === Number(value) ? t : String(value))), [value]);

  const error = quantityError(text, unit);
  const commit = (n) => {
    const rounded = Math.round(n * 1000) / 1000;
    setText(String(rounded));
    if (!quantityError(rounded, unit)) onChange(rounded);
  };

  return (
    <Stack direction="row" sx={{ alignItems: 'flex-start', width }}>
      <TextField
        size={size}
        type="number"
        value={text}
        disabled={disabled}
        error={!!error}
        helperText={error || ' '}
        onChange={(e) => {
          setText(e.target.value);
          if (!quantityError(e.target.value, unit)) onChange(Number(e.target.value));
        }}
        onBlur={() => { if (error) setText(String(value)); }}
        slotProps={{
          htmlInput: {
            inputMode: isDecimalUnit(unit) ? 'decimal' : 'numeric',
            step: isDecimalUnit(unit) ? 0.001 : 1,
            min: 0,
            style: { textAlign: 'center', padding: '6px 0' },
            'aria-label': 'Quantity',
          },
          formHelperText: { sx: { mx: 0, whiteSpace: 'nowrap' } },
          input: {
            sx: { px: 0 },
            startAdornment: (
              <InputAdornment position="start" sx={{ mr: 0 }}>
                <IconButton
                  size="small"
                  aria-label="Decrease"
                  disabled={disabled || Number(value) - step <= 0}
                  onClick={() => commit(Number(value) - step)}
                >
                  <RemoveIcon fontSize="small" />
                </IconButton>
              </InputAdornment>
            ),
            endAdornment: (
              <InputAdornment position="end" sx={{ ml: 0 }}>
                <IconButton size="small" aria-label="Increase" disabled={disabled} onClick={() => commit(Number(value) + step)}>
                  <AddIcon fontSize="small" />
                </IconButton>
              </InputAdornment>
            ),
          },
        }}
      />
    </Stack>
  );
}
