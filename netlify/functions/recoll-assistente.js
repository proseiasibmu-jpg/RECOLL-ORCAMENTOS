exports.handler = async (event) => {
  const json = (obj, statusCode = 200) => ({
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(obj)
  });

  if (event.httpMethod !== 'POST') {
    return json({ content: 'O Assistente RECOLL aceita somente solicitações POST.' }, 405);
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const quoteContext = body.quoteContext || '';
    const attachments = Array.isArray(body.attachments) ? body.attachments : [];
    const inspectionMode = body.mode === 'inspection';

    if (!process.env.OPENAI_API_KEY) {
      return json({
        content: 'A variável OPENAI_API_KEY não está disponível nesta função do Netlify. Não envie sua chave pelo aplicativo ou pelo chat.'
      }, 500);
    }

    if (attachments.length > 16) {
      return json({ content: 'Foram enviadas imagens demais. Reduza a quantidade e tente novamente.' }, 400);
    }
    const validAttachments = [];
    for (const item of attachments) {
      if (typeof item !== 'string' ||
          !/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(item) ||
          item.length > 7 * 1024 * 1024) {
        return json({ content: 'Uma das imagens está em formato inválido ou é muito grande. Tente novamente com imagens menores.' }, 400);
      }
      validAttachments.push(item);
    }
    if (inspectionMode && validAttachments.length === 0) {
      return json({ content: 'Nenhuma imagem foi recebida para análise.' }, 400);
    }

    const system = `Você é o Assistente Inteligente da RECOLL, empresa brasileira de reforma, construção, manutenção e limpeza pós-obra.
Responda em português do Brasil, de forma prática, clara e amigável.
A RECOLL normalmente cobra mão de obra e o cliente fornece os materiais; respeite essa condição.
Considere cidade/região, quantidade, unidade, produtividade, equipe, dias, dificuldade, altura/acesso, deslocamento e equipamentos.
Referências históricas indicativas de mão de obra: porcelanato em torno de R$ 60/m²; piso cerâmico em torno de R$ 40–43/m²; limpeza pós-obra em torno de R$ 9–11/m². Não são preços fixos.
Não invente nem atribua valores ao SINAPI. Não apresente estimativa como cotação oficial.
${inspectionMode ? `MODO VISTORIA VISUAL: analise as imagens recebidas. Descreva apenas danos e condições realmente visíveis; não afirme causas ocultas como certeza. Sugira serviços pertinentes. Nunca invente dimensões, áreas ou quantidades sem escala ou referência confiável: use quantity 0 e explique que precisa medir no local quando necessário. Preços são estimativas de mão de obra, não incluem materiais. Aponte limitações, riscos e pontos que exigem inspeção presencial. A análise não substitui profissional no local.
` : `MODO ORÇAMENTO: ajude a chegar a preço comercial competitivo e sustentável para mão de obra. Se faltarem dados essenciais, faça perguntas curtas e retorne items vazio.`}
Dados de contexto: ${quoteContext}
Retorne SOMENTE JSON válido neste formato:
{"message":"resumo claro","notes":"premissas, limitações ou dados faltantes","items":[{"description":"serviço","quantity":1,"unit":"m²","unit_price":60}]}
quantity e unit_price devem ser números. Quando quantidade não puder ser estimada, use 0 e explique em notes. Não inclua custos internos, margem ou fórmulas no texto destinado ao cliente.`;

    const input = [{ role: 'developer', content: system }];
    const recentMessages = messages.slice(-20);
    for (const message of recentMessages) {
      if (!message || !['user', 'assistant'].includes(message.role)) continue;
      input.push({ role: message.role, content: String(message.content || '') });
    }
    if (validAttachments.length) {
      let lastUser = -1;
      for (let i = input.length - 1; i >= 0; i--) {
        if (input[i].role === 'user') { lastUser = i; break; }
      }
      if (lastUser < 0) input.push({ role: 'user', content: 'Analise as imagens anexadas.' }), lastUser = input.length - 1;
      const textPart = typeof input[lastUser].content === 'string' ? input[lastUser].content : '';
      input[lastUser].content = [
        { type: 'input_text', text: textPart },
        ...validAttachments.map(image_url => ({ type: 'input_image', image_url, detail: 'high' }))
      ];
    }

    const model = process.env.OPENAI_MODEL || 'gpt-6-luna';
    let response;
    try {
      response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({ model, input, text: { format: { type: 'json_object' } }, store: false })
      });
    } catch (networkError) {
      return json({ content: 'Não foi possível conectar à API da OpenAI: ' + (networkError?.message || 'erro de rede') }, 502);
    }

    const requestId = response.headers.get('x-request-id') || '';
    const raw = await response.text();
    let data;
    try { data = JSON.parse(raw); } catch (_) { data = null; }

    if (!response.ok) {
      const apiMessage = data?.error?.message || raw || 'A API não informou o motivo.';
      const req = requestId ? ' Request ID: ' + requestId : '';
      return json({ content: 'Erro na API da OpenAI (HTTP ' + response.status + '): ' + apiMessage + req }, response.status >= 500 ? 502 : 400);
    }

    let content = data?.output_text || '';
    if (!content && Array.isArray(data?.output)) {
      const parts = [];
      for (const item of data.output) {
        if (Array.isArray(item?.content)) {
          for (const part of item.content) if (typeof part?.text === 'string') parts.push(part.text);
        }
      }
      content = parts.join('\n').trim();
    }
    if (!content) return json({ content: 'A OpenAI respondeu, mas não retornou texto para a RECOLL.' }, 502);
    return json({ content });
  } catch (e) {
    return json({ content: 'Erro interno ao processar a solicitação: ' + (e?.message || 'erro desconhecido') }, 500);
  }
};
