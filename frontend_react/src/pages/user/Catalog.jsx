import AddShoppingCartIcon from '@mui/icons-material/AddShoppingCart';
import SearchIcon from '@mui/icons-material/Search';
import SearchOffIcon from '@mui/icons-material/SearchOff';
import {
  Box, Button, Card, CardActions, CardContent, Chip, Grid, InputAdornment, Pagination, Skeleton, Stack, TextField,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import api, { errorMessage } from '../../api/client';
import QuantityInput from '../../components/QuantityInput';
import { EmptyState, PageHeader } from '../../components/common';
import { useCart } from '../../context/CartContext';
import { useNotify } from '../../context/NotifyContext';
import { useSettings } from '../../context/SettingsContext';
import { formatQty, isDecimalUnit } from '../../utils/format';

const PAGE_SIZE = 24;

function ProductCard({ product }) {
  const cart = useCart();
  const notify = useNotify();
  const { fmt } = useSettings();
  const [qty, setQty] = useState(1);
  const outOfStock = product.in_stock !== null && product.in_stock <= 0;

  return (
    <Card className="product-card" sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <CardContent sx={{ flexGrow: 1 }}>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
          <Typography sx={{ fontWeight: 600 }}>{product.name}</Typography>
          <Chip size="small" label={product.category} />
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, minHeight: 40 }}>
          {product.description}
        </Typography>
        <Typography variant="h6" color="primary" sx={{ mt: 1 }}>
          {fmt(product.price)} <Typography component="span" variant="body2" color="text.secondary">/ {product.unit}</Typography>
        </Typography>
        {product.in_stock !== null && (
          <Typography variant="caption" color={outOfStock ? 'error' : 'text.secondary'}>
            {outOfStock ? 'Out of stock' : `In stock: ${formatQty(product.in_stock, product.unit)}`}
          </Typography>
        )}
      </CardContent>
      <CardActions sx={{ px: 2, pb: 2, pt: 0, alignItems: 'flex-start', gap: 1 }}>
        <QuantityInput value={qty} unit={product.unit} onChange={setQty} disabled={outOfStock} width={140} />
        <Button
          variant="contained"
          startIcon={<AddShoppingCartIcon />}
          disabled={outOfStock}
          onClick={() => {
            cart.add(product, qty);
            notify(`Added ${formatQty(qty, product.unit)} ${product.name}`);
            setQty(1);
          }}
          aria-label={`Add to cart, ${fmt(qty * product.price)}`}
          sx={{ flexGrow: 1, height: 40, whiteSpace: 'nowrap' }}
        >
          {fmt(qty * product.price)}
        </Button>
      </CardActions>
      {isDecimalUnit(product.unit) && (
        <Typography variant="caption" color="text.secondary" sx={{ px: 2, pb: 1, mt: -1.5 }}>
          Loose item: enter any amount, e.g. 0.75
        </Typography>
      )}
    </Card>
  );
}

export default function Catalog() {
  const notify = useNotify();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [categories, setCategories] = useState([]);
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get('/categories').then((r) => setCategories(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      api.get('/products', { params: { q: search || undefined, category: category || undefined, page, page_size: PAGE_SIZE } })
        .then((r) => setData(r.data))
        .catch((err) => notify(errorMessage(err), 'error'));
    }, 250);
    return () => clearTimeout(t);
  }, [search, category, page, notify]);

  return (
    <>
      <PageHeader title="Products" subtitle="Pick a quantity and add items to your cart" />
      <Stack sx={{ gap: 2, mb: 3 }}>
        <TextField
          placeholder="Search by name, category or description"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> } }}
          sx={{ bgcolor: 'background.paper', maxWidth: 560 }}
        />
        <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
          <Chip label="All" color={!category ? 'primary' : 'default'} onClick={() => { setCategory(''); setPage(1); }} />
          {categories.map((c) => (
            <Chip key={c} label={c} color={category === c ? 'primary' : 'default'}
              onClick={() => { setCategory(c); setPage(1); }} />
          ))}
        </Stack>
      </Stack>

      {!data ? (
        <Grid container spacing={2}>
          {Array.from({ length: 8 }).map((_, i) => (
            <Grid key={i} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}><Skeleton variant="rounded" height={220} /></Grid>
          ))}
        </Grid>
      ) : data.items.length === 0 ? (
        <EmptyState icon={<SearchOffIcon />} title="No products found">Try a different search or category.</EmptyState>
      ) : (
        <>
          <Grid container spacing={2}>
            {data.items.map((p) => (
              <Grid key={p.product_id} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}><ProductCard product={p} /></Grid>
            ))}
          </Grid>
          {data.total > PAGE_SIZE && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
              <Pagination count={Math.ceil(data.total / PAGE_SIZE)} page={page} onChange={(_, p) => setPage(p)} />
            </Box>
          )}
        </>
      )}
    </>
  );
}
