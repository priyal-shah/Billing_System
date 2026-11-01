import AddCommentIcon from '@mui/icons-material/AddCommentOutlined';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import CloseIcon from '@mui/icons-material/Close';
import ImageIcon from '@mui/icons-material/AddPhotoAlternateOutlined';
import MicIcon from '@mui/icons-material/Mic';
import SendIcon from '@mui/icons-material/Send';
import StopIcon from '@mui/icons-material/Stop';
import {
  Alert, Box, Chip, CircularProgress, Divider, Drawer, Fab, IconButton, MenuItem, Paper, Select, Stack, TextField,
  Tooltip, Typography,
} from '@mui/material';
import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { errorMessage } from '../../api/client';
import { aiApi } from './aiApi';
import ApprovalBatch from './ApprovalCards';
import { prepareImage, useSpeech } from './media';

const STORE_KEY = 'ai_conversation_id';
const LANG_KEY = 'ai_speech_lang';
const EXAMPLES = [
  'How many orders and how much sales today?',
  'Which products are low on stock (5 or less)?',
  'Top 5 products this month',
  'Change the price of Toor Dal to 165',
];

function storage(key, value) {
  try {
    if (value === undefined) return sessionStorage.getItem(key);
    if (value === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, value);
  } catch { /* private mode etc. */ }
  return null;
}

const markdownSx = {
  '& p': { my: 0.5 }, '& ul, & ol': { my: 0.5, pl: 2.5 },
  '& table': { borderCollapse: 'collapse', my: 1, fontSize: '0.85rem', display: 'block', overflowX: 'auto' },
  '& th, & td': { border: 1, borderColor: 'divider', px: 0.75, py: 0.25, textAlign: 'left' },
  '& code': { fontSize: '0.85em' },
};

function Message({ msg, onActionChange }) {
  const mine = msg.role === 'user';
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'stretch' }}>
      <Paper
        elevation={0}
        sx={{
          px: 1.5, py: 1, maxWidth: mine ? '85%' : '100%', wordBreak: 'break-word',
          bgcolor: mine ? 'primary.main' : 'grey.100', color: mine ? 'primary.contrastText' : 'text.primary',
        }}
      >
        {mine ? (
          <>
            {msg.imageUrl && (
              <Box component="img" src={msg.imageUrl} alt="Attached"
                sx={{ display: 'block', maxWidth: '100%', maxHeight: 180, borderRadius: 1, mb: msg.text ? 1 : 0 }} />
            )}
            {msg.text && <Typography sx={{ whiteSpace: 'pre-wrap' }}>{msg.text}</Typography>}
            {(msg.source === 'voice' || (msg.has_image && !msg.imageUrl)) && (
              <Typography variant="caption" sx={{ opacity: 0.8 }}>
                {msg.source === 'voice' ? 'Spoken' : 'Photo attached'}
              </Typography>
            )}
          </>
        ) : (
          <Box sx={markdownSx}><ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text}</ReactMarkdown></Box>
        )}
      </Paper>
      {!mine && msg.actions?.length > 0 && <ApprovalBatch actions={msg.actions} onActionChange={onActionChange} />}
    </Box>
  );
}

export default function AiAssistant() {
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [conversationId, setConversationId] = useState(() => storage(STORE_KEY));
  const [messages, setMessages] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [input, setInput] = useState('');
  const [usedVoice, setUsedVoice] = useState(false);
  const [image, setImage] = useState(null); // { blob, url }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [lang, setLang] = useState(() => storage(LANG_KEY) || 'en-IN');
  const listRef = useRef(null);
  const fileRef = useRef(null);
  const voiceBase = useRef('');

  const speech = useSpeech({
    lang,
    onText: (t) => setInput(voiceBase.current ? `${voiceBase.current} ${t}` : t),
  });

  useEffect(() => {
    aiApi.status().then((s) => setEnabled(s.enabled)).catch(() => setEnabled(false));
  }, []);

  // Restore the current chat the first time the panel opens.
  useEffect(() => {
    if (!open || loaded) return;
    setLoaded(true);
    if (!conversationId) return;
    aiApi.conversation(conversationId)
      .then((c) => setMessages(c.messages))
      .catch(() => { storage(STORE_KEY, null); setConversationId(null); });
  }, [open, loaded, conversationId]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  const updateAction = useCallback((updated) => {
    setMessages((ms) => ms.map((m) => (m.actions?.some((a) => a.action_id === updated.action_id)
      ? { ...m, actions: m.actions.map((a) => (a.action_id === updated.action_id ? updated : a)) }
      : m)));
  }, []);

  const newChat = () => {
    speech.stop();
    storage(STORE_KEY, null);
    setConversationId(null);
    setMessages([]);
    setError('');
    setInput('');
    setImage(null);
  };

  const toggleMic = () => {
    if (speech.listening) { speech.stop(); return; }
    voiceBase.current = input.trim();
    setUsedVoice(true);
    speech.start();
  };

  const pickImage = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const blob = await prepareImage(file);
      setImage({ blob, url: URL.createObjectURL(blob) });
    } catch (err) {
      setError(err.message || 'Could not read this image');
    }
  };

  const send = async (text = input) => {
    const message = text.trim();
    if ((!message && !image) || busy) return;
    speech.stop();
    setError('');
    const source = usedVoice ? 'voice' : 'text';
    const sentImage = image;
    setMessages((ms) => [...ms, { role: 'user', text: message, source, imageUrl: sentImage?.url }]);
    setInput('');
    setImage(null);
    setUsedVoice(false);
    setBusy(true);
    try {
      const res = await aiApi.chat({ message, source, conversationId, image: sentImage?.blob });
      if (res.conversation_id !== conversationId) {
        setConversationId(res.conversation_id);
        storage(STORE_KEY, res.conversation_id);
      }
      setMessages((ms) => [...ms, { role: 'assistant', text: res.reply, actions: res.actions }]);
    } catch (err) {
      setError(errorMessage(err));
      setMessages((ms) => ms.slice(0, -1)); // un-send, so the text can be retried
      setInput(message);
      if (sentImage) setImage(sentImage);
    } finally {
      setBusy(false);
    }
  };

  if (!enabled) return null;

  return (
    <>
      <Tooltip title="AI assistant" placement="left">
        <Fab color="secondary" aria-label="Open AI assistant" onClick={() => setOpen(true)} className="no-print"
          sx={{ position: 'fixed', right: { xs: 16, sm: 24 }, bottom: { xs: 16, sm: 24 }, zIndex: (t) => t.zIndex.speedDial }}>
          <AutoAwesomeIcon />
        </Fab>
      </Tooltip>

      <Drawer anchor="right" open={open} onClose={() => setOpen(false)} className="no-print"
        slotProps={{ paper: { sx: { width: { xs: '100%', sm: 460 }, display: 'flex', flexDirection: 'column' } } }}>
        <Stack direction="row" sx={{ alignItems: 'center', px: 2, py: 1, gap: 1 }}>
          <AutoAwesomeIcon color="secondary" />
          <Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 700 }}>Assistant</Typography>
          <Tooltip title="New chat">
            <span>
              <IconButton onClick={newChat} disabled={busy} aria-label="New chat"><AddCommentIcon /></IconButton>
            </span>
          </Tooltip>
          <IconButton onClick={() => setOpen(false)} aria-label="Close assistant"><CloseIcon /></IconButton>
        </Stack>
        <Divider />

        <Box ref={listRef} sx={{ flexGrow: 1, overflowY: 'auto', p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {messages.length === 0 && (
            <Box>
              <Typography color="text.secondary" sx={{ mb: 1.5 }}>
                Ask about products, orders, bills and sales, or ask for product changes by typing, speaking or
                sending a photo of a price list. Changes are only saved after you approve them.
              </Typography>
              <Stack sx={{ gap: 1, alignItems: 'flex-start' }}>
                {EXAMPLES.map((q) => (
                  <Chip key={q} label={q} variant="outlined" onClick={() => send(q)} clickable />
                ))}
              </Stack>
            </Box>
          )}
          {messages.map((m, i) => <Message key={i} msg={m} onActionChange={updateAction} />)}
          {busy && (
            <Stack direction="row" sx={{ alignItems: 'center', gap: 1, color: 'text.secondary' }}>
              <CircularProgress size={18} /> <Typography variant="body2">Thinking…</Typography>
            </Stack>
          )}
        </Box>

        <Divider />
        <Box sx={{ p: 1.5 }}>
          {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 1 }}>{error}</Alert>}
          {image && (
            <Box sx={{ position: 'relative', display: 'inline-block', mb: 1 }}>
              <Box component="img" src={image.url} alt="To send" sx={{ height: 72, borderRadius: 1, display: 'block' }} />
              <IconButton size="small" aria-label="Remove photo" onClick={() => setImage(null)}
                sx={{ position: 'absolute', top: -10, right: -10, bgcolor: 'background.paper', boxShadow: 1,
                  '&:hover': { bgcolor: 'background.paper' } }}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </Box>
          )}
          <TextField
            fullWidth multiline maxRows={5} size="small"
            placeholder={speech.listening ? 'Listening… speak now' : 'Ask or describe a change…'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
            }}
            disabled={busy}
          />
          <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5, mt: 1 }}>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickImage} />
            <Tooltip title="Attach a photo (price list, label, note)">
              <span>
                <IconButton onClick={() => fileRef.current?.click()} disabled={busy} aria-label="Attach photo">
                  <ImageIcon />
                </IconButton>
              </span>
            </Tooltip>
            {speech.supported && (
              <>
                <Tooltip title={speech.listening ? 'Stop listening' : 'Speak'}>
                  <span>
                    <IconButton onClick={toggleMic} disabled={busy} aria-label={speech.listening ? 'Stop listening' : 'Speak'}
                      color={speech.listening ? 'error' : 'default'}
                      sx={speech.listening ? { animation: 'aiPulse 1.2s infinite',
                        '@keyframes aiPulse': { '50%': { opacity: 0.4 } } } : undefined}>
                      {speech.listening ? <StopIcon /> : <MicIcon />}
                    </IconButton>
                  </span>
                </Tooltip>
                <Select size="small" variant="standard" value={lang} disableUnderline disabled={speech.listening}
                  onChange={(e) => { setLang(e.target.value); storage(LANG_KEY, e.target.value); }}
                  inputProps={{ 'aria-label': 'Speech language' }} sx={{ fontSize: '0.85rem' }}>
                  <MenuItem value="en-IN">English</MenuItem>
                  <MenuItem value="hi-IN">हिन्दी</MenuItem>
                </Select>
              </>
            )}
            <Box sx={{ flexGrow: 1 }} />
            <IconButton color="primary" onClick={() => send()} disabled={busy || (!input.trim() && !image)} aria-label="Send">
              <SendIcon />
            </IconButton>
          </Stack>
        </Box>
      </Drawer>
    </>
  );
}
