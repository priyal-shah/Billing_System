import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import EditIcon from '@mui/icons-material/Edit';
import {
  Alert, Box, Button, Checkbox, Chip, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow,
  TextField, Typography,
} from '@mui/material';
import { useState } from 'react';
import { errorMessage } from '../../api/client';
import { useNotify } from '../../context/NotifyContext';
import { useSettings } from '../../context/SettingsContext';
import { UNITS } from '../../utils/format';
import { aiApi } from './aiApi';

const STATUS = {
  pending: { label: 'Waiting for approval', color: 'warning' },
  approved: { label: 'Approved', color: 'success' },
  rejected: { label: 'Rejected', color: 'default' },
  expired: { label: 'Expired', color: 'default' },
  stale: { label: 'Out of date', color: 'error' },
  applying: { label: 'Saving…', color: 'info' },
};
const ALL_FIELDS = ['name', 'category', 'description', 'price', 'unit', 'gst_rate', 'in_stock'];
const LABELS = {
  name: 'Name', category: 'Category', description: 'Description', price: 'Price', unit: 'Unit',
  gst_rate: 'GST rate (%)', in_stock: 'Stock',
};

/** Tell open pages (e.g. Products) to reload after an approved change. */
export const PRODUCTS_CHANGED = 'products-changed';

function useFormatValue() {
  const { fmt } = useSettings();
  return (field, v) => {
    if (v === null || v === undefined || v === '') return field === 'in_stock' ? 'Not tracked' : '—';
    if (field === 'price') return fmt(v);
    if (field === 'gst_rate') return `${v}%`;
    return String(v);
  };
}

function EditFields({ fields, values, onChange }) {
  const set = (f) => (e) => onChange({ ...values, [f]: e.target.value });
  return (
    <Stack sx={{ gap: 1.5, mt: 1 }}>
      {fields.map((f) => (f === 'unit' ? (
        <TextField key={f} select size="small" label={LABELS[f]} value={values[f] ?? 'pcs'} onChange={set(f)}>
          {UNITS.map((u) => <MenuItem key={u} value={u}>{u}</MenuItem>)}
        </TextField>
      ) : (
        <TextField
          key={f} size="small" label={LABELS[f]} value={values[f] ?? ''} onChange={set(f)}
          type={['price', 'gst_rate', 'in_stock'].includes(f) ? 'number' : 'text'}
          multiline={f === 'description'}
          helperText={f === 'in_stock' || f === 'gst_rate' ? 'Leave empty for none' : undefined}
        />
      )))}
    </Stack>
  );
}

function ApprovalCard({ action, onChange, selectable, selected, onSelect }) {
  const notify = useNotify();
  const formatValue = useFormatValue();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const isCreate = action.kind === 'create';
  const editFields = isCreate ? ALL_FIELDS : action.changes.map((c) => c.field);
  const [draft, setDraft] = useState({});
  const pending = action.status === 'pending';
  const st = STATUS[action.status] || { label: action.status, color: 'default' };

  const refresh = () => aiApi.action(action.action_id).then(onChange).catch(() => {});

  const run = async (fn, okMsg) => {
    setBusy(true);
    try {
      const updated = await fn();
      onChange(updated);
      setEditing(false);
      if (updated.status === 'approved') window.dispatchEvent(new Event(PRODUCTS_CHANGED));
      notify(okMsg(updated));
    } catch (err) {
      notify(errorMessage(err), 'error');
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const approve = () => {
    let changes = null;
    if (editing) {
      changes = {};
      editFields.forEach((f) => {
        const v = draft[f];
        changes[f] = v === '' && ['gst_rate', 'in_stock'].includes(f) ? null : v;
      });
    }
    run(() => aiApi.approve(action.action_id, changes),
      (a) => (isCreate ? `Added ${a.product_name} (${a.product_id})` : `Updated ${a.product_name}`));
  };
  const reject = () => run(() => aiApi.reject(action.action_id), () => 'Change rejected; nothing was saved');

  const startEdit = () => {
    setDraft(Object.fromEntries(editFields.map((f) => [f, action.after[f] ?? ''])));
    setEditing(true);
  };

  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderColor: pending ? 'warning.main' : 'divider' }}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: 1 }}>
        {selectable && pending && (
          <Checkbox size="small" checked={selected} onChange={(e) => onSelect(e.target.checked)} sx={{ p: 0.25 }}
            slotProps={{ input: { 'aria-label': `Select ${action.product_name}` } }} />
        )}
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 600 }} noWrap>
            {isCreate ? 'New product: ' : ''}{action.product_name}
          </Typography>
          {action.product_id && <Typography variant="caption" color="text.secondary">{action.product_id}</Typography>}
        </Box>
        <Chip size="small" label={st.label} color={st.color} variant={pending ? 'outlined' : 'filled'} />
      </Stack>

      {action.warning && pending && <Alert severity="warning" sx={{ mb: 1, py: 0 }}>{action.warning}</Alert>}

      {editing ? (
        <EditFields fields={editFields} values={draft} onChange={setDraft} />
      ) : (
        <Table size="small" sx={{ '& td, & th': { px: 0.75 } }}>
          <TableHead>
            <TableRow>
              <TableCell>Field</TableCell>
              {!isCreate && <TableCell>Current</TableCell>}
              <TableCell>{isCreate ? 'Value' : 'New'}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {action.changes.map((c) => (
              <TableRow key={c.field}>
                <TableCell>{c.label}</TableCell>
                {!isCreate && (
                  <TableCell sx={{ color: 'text.secondary', textDecoration: 'line-through' }}>
                    {formatValue(c.field, c.current)}
                  </TableCell>
                )}
                <TableCell sx={{ fontWeight: 700, color: 'success.dark', bgcolor: 'rgba(46,125,50,0.08)' }}>
                  {formatValue(c.field, c.proposed)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {action.reason && (
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
          Source: {action.reason}
        </Typography>
      )}
      {action.edited && action.status === 'approved' && (
        <Typography variant="caption" color="text.secondary">Edited by you before approving.</Typography>
      )}
      {action.status === 'stale' && (
        <Alert severity="info" sx={{ mt: 1, py: 0 }}>
          The product changed after this was proposed, so nothing was saved. Ask again for a fresh proposal.
        </Alert>
      )}

      {pending && (
        <Stack direction="row" sx={{ gap: 1, mt: 1.5, flexWrap: 'wrap' }}>
          <Button size="small" variant="contained" color="success" startIcon={<CheckIcon />} onClick={approve}
            disabled={busy}>
            {editing ? 'Approve edited' : 'Approve'}
          </Button>
          {editing ? (
            <Button size="small" onClick={() => setEditing(false)} disabled={busy}>Cancel edit</Button>
          ) : (
            <Button size="small" startIcon={<EditIcon />} onClick={startEdit} disabled={busy}>Edit</Button>
          )}
          <Button size="small" color="error" startIcon={<CloseIcon />} onClick={reject} disabled={busy}>Reject</Button>
        </Stack>
      )}
    </Paper>
  );
}

/** One or more proposed changes from a single assistant reply. Several can be approved together. */
export default function ApprovalBatch({ actions, onActionChange }) {
  const notify = useNotify();
  const [selected, setSelected] = useState(() => new Set(actions.map((a) => a.action_id)));
  const [busy, setBusy] = useState(false);
  const pending = actions.filter((a) => a.status === 'pending');
  const chosen = pending.filter((a) => selected.has(a.action_id));
  const multi = actions.length > 1;

  const bulk = async (kind) => {
    setBusy(true);
    let ok = 0;
    const failed = [];
    for (const a of chosen) {
      try {
        const updated = await (kind === 'approve' ? aiApi.approve(a.action_id) : aiApi.reject(a.action_id));
        onActionChange(updated);
        ok += 1;
      } catch (err) {
        failed.push(`${a.product_name}: ${errorMessage(err)}`);
        aiApi.action(a.action_id).then(onActionChange).catch(() => {});
      }
    }
    setBusy(false);
    if (kind === 'approve' && ok) window.dispatchEvent(new Event(PRODUCTS_CHANGED));
    if (failed.length) notify(failed.join(' · '), 'error');
    else notify(kind === 'approve' ? `${ok} change(s) saved` : `${ok} change(s) rejected`);
  };

  return (
    <Stack sx={{ gap: 1, mt: 1 }}>
      {multi && pending.length > 1 && (
        <Stack direction="row" sx={{ gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="body2" sx={{ flexGrow: 1 }}>{pending.length} changes waiting</Typography>
          <Button size="small" variant="contained" color="success" disabled={busy || !chosen.length}
            onClick={() => bulk('approve')}>
            Approve selected ({chosen.length})
          </Button>
          <Button size="small" color="error" disabled={busy || !chosen.length} onClick={() => bulk('reject')}>
            Reject selected
          </Button>
        </Stack>
      )}
      {actions.map((a) => (
        <ApprovalCard
          key={a.action_id}
          action={a}
          onChange={onActionChange}
          selectable={multi && pending.length > 1}
          selected={selected.has(a.action_id)}
          onSelect={(on) => setSelected((s) => {
            const next = new Set(s);
            if (on) next.add(a.action_id); else next.delete(a.action_id);
            return next;
          })}
        />
      ))}
    </Stack>
  );
}
