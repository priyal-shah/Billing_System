import { Autocomplete, Box, TextField, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import api from '../api/client';
import { useSettings } from '../context/SettingsContext';

/** Searchable product selector backed by the products API. */
export default function ProductPicker({ value, onChange, excludeIds = [], disabled }) {
  const { fmt } = useSettings();
  const [input, setInput] = useState('');
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const t = setTimeout(() => {
      api.get('/products', { params: { q: input || undefined, page_size: 30 } })
        .then((r) => active && setOptions(r.data.items))
        .finally(() => active && setLoading(false));
    }, 250);
    return () => { active = false; clearTimeout(t); };
  }, [input]);

  return (
    <Autocomplete
      sx={{ flexGrow: 1, minWidth: 260 }}
      size="small"
      disabled={disabled}
      value={value}
      onChange={(_, v) => onChange(v)}
      inputValue={input}
      onInputChange={(_, v) => setInput(v)}
      options={options}
      loading={loading}
      filterOptions={(x) => x}
      getOptionDisabled={(o) => excludeIds.includes(o.product_id)}
      getOptionLabel={(o) => o.name}
      isOptionEqualToValue={(a, b) => a.product_id === b.product_id}
      renderOption={(props, o) => {
        const { key, ...rest } = props;
        return (
          <Box component="li" key={key} {...rest} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
            <span>
              {o.name}{' '}
              <Typography component="span" variant="caption" color="text.secondary">
                {o.category}{excludeIds.includes(o.product_id) ? ' · already in order' : ''}
              </Typography>
            </span>
            <span>{fmt(o.price)} / {o.unit}</span>
          </Box>
        );
      }}
      renderInput={(params) => <TextField {...params} label="Add product" placeholder="Search products" />}
    />
  );
}
