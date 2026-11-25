export async function onRequestPost({ request, env }) {
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });

  try {
    const body = await request.json();
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const quoteContext = body.quoteContext || "";

    if (!env.OPENAI_API_KEY) {
      return json({ content: "A configuração da IA ainda não foi concluída no servidor Cloudflare. A chave OPENAI_API_KEY não está cadastrada." }, 500);
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

    const model = env.OPENAI_MODEL || "gpt-6-luna";
    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model,
        input: [{ role: "developer", content: system }, ...messages.slice(-20)],
        text: { format: { type: "json_object" } },
        store: false
      })
    });

    const raw = await upstream.text();
    let data;
    try { data = JSON.parse(raw); } catch (_) { data = null; }

    if (!upstream.ok) {
      const message = data?.error?.message || raw || "A API da OpenAI não informou a mensagem do erro.";
      return json({ content: `Erro na API da OpenAI (HTTP ${upstream.status}): ${message}` }, 502);
    }

    let content = data?.output_text || "";
    if (!content && Array.isArray(data?.output)) {
      const parts = [];
      for (const item of data.output) {
        if (Array.isArray(item?.content)) {
          for (const part of item.content) if (typeof part?.text === "string") parts.push(part.text);
        }
      }
      content = parts.join("\\n").trim();
    }
    if (!content) return json({ content: "A OpenAI respondeu, mas não retornou texto para o assistente." }, 502);
    return json({ content });
  } catch (error) {
    return json({ content: `Erro interno no Assistente RECOLL: ${error?.message || "erro desconhecido"}.` }, 500);
  }
}
