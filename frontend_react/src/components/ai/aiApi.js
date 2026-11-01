import api from '../../api/client';

/** Calls for the admin AI assistant (backend: /api/ai). */
export const aiApi = {
  status: () => api.get('/ai/status').then((r) => r.data),
  conversation: (id) => api.get(`/ai/conversations/${id}`).then((r) => r.data),
  chat: ({ message, source, conversationId, image }) => {
    const form = new FormData();
    form.append('message', message);
    form.append('source', source);
    if (conversationId) form.append('conversation_id', conversationId);
    if (image) form.append('image', image, 'photo.jpg');
    return api.post('/ai/chat', form, { timeout: 180000 }).then((r) => r.data);
  },
  action: (id) => api.get(`/ai/actions/${id}`).then((r) => r.data),
  approve: (id, changes) => api.post(`/ai/actions/${id}/approve`, changes ? { changes } : {}).then((r) => r.data),
  reject: (id) => api.post(`/ai/actions/${id}/reject`).then((r) => r.data),
};
