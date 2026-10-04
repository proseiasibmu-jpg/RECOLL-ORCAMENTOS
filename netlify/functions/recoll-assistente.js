exports.handler = async function(event) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Método não permitido." })
    };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const quoteContext = body.quoteContext || {};

    if (!process.env.OPENAI_API_KEY) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: "OPENAI_API_KEY não configurada no Netlify."
        })
      };
    }

    const instructions = `
Você é o Assistente de Orçamento da RECOLL — Reforma, Construção e Limpeza.

Converse em português do Brasil, de forma prática, clara e direta.

Ajude o usuário a chegar a um preço comercial com boa chance de fechar o serviço.
Não trate uma fórmula como regra rígida.

Considere:
- quantidade e unidade;
- produtividade real;
- profissionais e ajudantes;
- custo diário;
- quantidade de dias;
- dificuldade;
- deslocamento;
- materiais;
- equipamentos;
- volume;
- urgência;
- relacionamento com o cliente;
- preço praticado pelo usuário;
- realidade comercial.

A divisão do custo por 60% é somente uma referência interna quando fizer sentido.
Nunca mostre ao cliente custo interno, margem, lucro ou fórmulas internas.

Não invente preços oficiais do SINAPI/SINAP.
Se o usuário fornecer seus próprios preços, trate-os como referências da RECOLL.

Quando houver informações suficientes, apresente:
1. estimativa de custo interno;
2. faixa comercial;
3. valor que considera bom para fechar;
4. motivo da recomendação.

Se faltarem informações importantes, faça poucas perguntas objetivas.

A decisão final do preço é sempre do usuário.
`;

    const response = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || "gpt-6-luna",
          store: false,
          instructions:
            instructions +
            "\n\nContexto do orçamento:\n" +
            JSON.stringify(quoteContext),
          input: messages
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({
          error:
            data?.error?.message ||
            "Erro ao consultar o assistente."
        })
      };
    }

    let text = data.output_text || "";

    if (!text && Array.isArray(data.output)) {
      for (const item of data.output) {
        if (Array.isArray(item.content)) {
          for (const part of item.content) {
            if (
              part.type === "output_text" &&
              part.text
            ) {
              text += part.text;
            }
          }
        }
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ text })
    };

  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: error?.message || "Erro interno no assistente."
      })
    };
  }
};
