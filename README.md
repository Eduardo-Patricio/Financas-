# Finanças

Aplicativo em português para controlar produtos de revenda e as contas da casa, com layout para celular e computador.

## O que funciona nesta versão

- Cadastro com nome, e-mail e senha; entrada e saída da conta.
- Casa compartilhada: gere um convite em **Nossa casa** e envie para a outra pessoa criar a própria conta. As duas pessoas podem editar os mesmos dados. O link vale por 7 dias, funciona uma vez e é substituído quando outro convite é criado.
- Brique: foto (JPG, PNG ou WebP, até 3 MB), custo total, preço do anúncio, datas, observações e registro de venda. Edição e exclusão de produtos.
- Indicadores de capital no estoque, vendas e lucro realizado.
- Contas: entradas, despesas, categorias, vencimentos e situação de pagamento. Filtro por mês, edição e exclusão.
- Dados persistidos em SQLite, separados por casa. O brique e o orçamento doméstico são independentes: uma transferência entre eles deve ser registrada manualmente.

## Executar

Requer **Node.js 24 ou superior**. Não há pacotes externos para instalar.

```bash
npm start
```

Abra `http://localhost:3000` e crie sua conta. O sistema começa vazio: não contém contas ou valores pessoais pré-cadastrados.

```bash
npm test
```

Os testes usam um banco temporário e verificam cadastro, login, convite, isolamento entre casas, venda, pagamento e validações de segurança.

## Hospedagem

Esta aplicação precisa de um servidor Node.js com disco persistente. **GitHub Pages não executa o servidor nem o banco de dados.** Publicar o código no GitHub não coloca o aplicativo no ar.

Configure estas variáveis no provedor:

| Variável | Uso |
| --- | --- |
| `HOST` | `0.0.0.0` para receber conexões na hospedagem; padrão local `127.0.0.1` |
| `PORT` | Porta definida pelo provedor; padrão `3000` |
| `DATA_DIR` | Diretório de disco persistente para o banco; padrão `./data` |
| `APP_URL` | Endereço HTTPS completo do aplicativo, sem caminho, por exemplo `https://financas.exemplo.com` |
| `COOKIE_SECURE` | Use `true` em produção com HTTPS |

Execute `npm start` atrás de um proxy HTTPS. Use uma única instância com acesso ao banco local. Configure backups regulares de SQLite com uma ferramenta de backup consistente ou interrompa a aplicação antes de copiar o diretório `data` inteiro (incluindo arquivos WAL/SHM, se houver). Nunca publique o diretório `data` no GitHub.

## Escopo e limites

- Ainda não inclui recuperação de senha por e-mail, verificação de e-mail, troca de senha, remoção de membros, importação bancária ou contas recorrentes automáticas.
- O convite serve para criar uma nova conta; não une duas contas que já pertencem a casas diferentes.
- As fotos ficam no banco, por isso backups podem crescer com o estoque.
- Senhas usam scrypt com sal individual. Sessões são aleatórias, armazenadas como hash no banco e enviadas por cookie HttpOnly. Ações autenticadas exigem token CSRF e conferência de origem. Todos os acessos a registros são limitados à casa do usuário.
- A aplicação aplica limite de tentativas de entrada/cadastro por IP. Atrás de um proxy, visitantes podem compartilhar o mesmo limite; configure proteção de acesso no provedor conforme o uso.
- O visual e os fluxos estão implementados. Uma URL acessível pela internet depende da contratação/configuração de uma hospedagem compatível.
