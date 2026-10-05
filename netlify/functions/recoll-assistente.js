exports.handler = async (event) => {
  const json = (obj) => ({
    statusCode: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(obj)
  });

  if (event.httpMethod !== 'POST') {
    return json({ content: 'O Assistente de Orçamento aceita somente solicitações POST.' });
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const quoteContext = body.quoteContext || '';

    if (!process.env.OPENAI_API_KEY) {
      return json({
        content: '🔎 DIAGNÓSTICO: a função RECOLL está publicada, mas a variável OPENAI_API_KEY não está disponível para esta função no Netlify. Não envie a chave aqui. Precisamos revisar apenas a variável de ambiente no Netlify.'
      });
    }

    const system = `Você é o Assistente de Orçamento da RECOLL, uma empresa brasileira de reforma, construção, manutenção e limpeza pós-obra.
Converse em português do Brasil, de forma prática, clara e amigável.
Seu objetivo é ajudar Oseias a chegar a um preço comercial que tenha chance de fechar, e não impor uma fórmula rígida.
Considere equipe, custo diário, produtividade, dias, dificuldade, deslocamento, materiais, equipamentos, volume e relação com o cliente.
A divisão por 60% é apenas uma referência interna quando ele quiser usar: custo de mão de obra ÷ 0,60. Nunca trate isso como regra obrigatória.
Não invente preços oficiais de SINAPI/SINAPI. Se faltarem dados, pergunte o essencial ou trabalhe com uma estimativa explicitamente marcada como estimativa.
O preço sugerido é interno: não diga para colocar custo, margem ou fórmula no orçamento do cliente.
Quando fizer sentido, apresente: custo estimado, faixa comercial sugerida e um valor que você considera bom para fechar, explicando brevemente o motivo.
Se o usuário der um preço que ele já pratica, respeite-o como referência e ajude a avaliar.
Se ele pedir para montar o orçamento, organize descrição, quantidade, unidade e preço final, mas não exponha cálculos internos ao cliente.
Dados do orçamento atual (podem estar vazios): ${quoteContext}`;

    const input = [{ role: 'developer', content: system }, ...messages.slice(-20)];
    const model = process.env.OPENAI_MODEL || 'gpt-6-luna';

    let response;
    try {
      response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({ model, input, store: false })
      });
    } catch (networkError) {
      return json({
        content: `🔎 DIAGNÓSTICO: a função RECOLL foi executada, mas não conseguiu alcançar a API da OpenAI. Detalhe técnico: ${networkError?.message || 'erro de rede'}.`
      });
    }

    const requestId = response.headers.get('x-request-id') || '';
    const raw = await response.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch (_) {
      data = null;
    }

    if (!response.ok) {
      const apiMessage = data?.error?.message || raw || 'A API da OpenAI não informou a mensagem do erro.';
      const apiType = data?.error?.type ? ` Tipo: ${data.error.type}.` : '';
      const apiCode = data?.error?.code ? ` Código: ${data.error.code}.` : '';
      const req = requestId ? ` Request ID: ${requestId}.` : '';
      return json({
        content: `🔎 DIAGNÓSTICO DA OPENAI: HTTP ${response.status}.${apiType}${apiCode} Mensagem: ${apiMessage}${req}`
      });
    }

    let content = data?.output_text || '';
    if (!content && Array.isArray(data?.output)) {
      const parts = [];
      for (const item of data.output) {
        if (Array.isArray(item?.content)) {
          for (const part of item.content) {
            if (typeof part?.text === 'string') parts.push(part.text);
          }
        }
      }
      content = parts.join('\n').trim();
    }

    if (!content) {
      const req = requestId ? ` Request ID: ${requestId}.` : '';
      return json({
        content: `🔎 DIAGNÓSTICO: a OpenAI respondeu com sucesso, mas não retornou texto para o Assistente.${req}`
      });
    }

    return json({ content });
  } catch (e) {
    return json({
      content: `🔎 DIAGNÓSTICO DA FUNÇÃO: ocorreu um erro interno ao processar a solicitação. Detalhe: ${e?.message || 'erro desconhecido'}.`
    });
  }
};
