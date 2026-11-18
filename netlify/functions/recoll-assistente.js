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

    const system = `Você é o Assistente Inteligente de Orçamento da RECOLL, empresa brasileira de reforma, construção, manutenção e limpeza pós-obra.
Responda em português do Brasil, de forma prática, clara e amigável.
Ajude Oseias a chegar a um preço comercial competitivo e sustentável para mão de obra. A RECOLL normalmente cobra mão de obra e o cliente fornece os materiais; respeite essa condição quando indicada no contexto.
Considere cidade/região, quantidade, unidade, tipo de obra, produtividade, equipe, dias, dificuldade, altura/acesso, deslocamento, equipamentos, volume e relacionamento comercial.
Use como referência os valores comerciais que a RECOLL já pratica quando forem pertinentes: assentamento de porcelanato em torno de R$ 60/m² em cenário padrão; assentamento de piso cerâmico em torno de R$ 40–43/m² conforme tipo e volume; limpeza pós-obra em torno de R$ 9–11/m² conforme dificuldade. São referências históricas indicativas, não preços fixos: ajuste pelo escopo e condições informadas.
A divisão por 60% é apenas uma referência interna se fizer sentido; nunca é regra obrigatória.
Não invente nem atribua valores ao SINAPI. Não apresente estimativa como cotação oficial.
Se faltarem informações essenciais para precificar com segurança, faça perguntas curtas e retorne items como array vazio. Se for possível estimar, deixe claro que é estimativa e explique as premissas.
Retorne SOMENTE um objeto JSON válido, sem markdown e sem texto fora do JSON, com esta estrutura:
{"message":"explicação amigável e recomendação","notes":"premissas, ressalvas ou perguntas; pode ser vazio","items":[{"description":"descrição curta do serviço","quantity":1,"unit":"m²","unit_price":60}]}
Use items com um ou mais itens apenas quando houver informação suficiente para uma recomendação de preço. quantity deve ser numérico, unit_price deve ser numérico em reais, unit deve ser unidade adequada (m², m, unidade, hora, diária ou serviço). Se o usuário não informar quantidade, pergunte e não crie quantidade fictícia.
O preço é de mão de obra, salvo se o usuário pedir expressamente outra coisa. Não inclua custos internos, margem ou fórmulas no texto destinado ao cliente.
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
        body: JSON.stringify({ model, input, text: { format: { type: 'json_object' } }, store: false })
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
