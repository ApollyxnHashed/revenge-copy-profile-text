# CopyProfileText

Plugin para o [Revenge](https://github.com/revenge-mod) que torna selecionável o texto de **bio**, **pronomes** e **status personalizado** nos perfis do Discord — áreas onde normalmente não dá pra selecionar/copiar texto.

Baseado na técnica do plugin [CopyBios](https://github.com/shipwr3ckd/revengeplugin/tree/master/plugins/CopyBios), de シグマ siguma.

## Como instalar

1. No Discord (client Revenge), vá em **Configurações > Revenge > Plugins**.
2. Toque em **+** / "Add plugin".
3. Cole a URL abaixo e confirme:

   ```
   https://SEU_USUARIO.github.io/NOME_DO_REPOSITORIO/CopyProfileText/
   ```

4. Ative o plugin na lista.

## Como funciona

Em vez de tentar adivinhar o nome interno exato de cada componente do Discord (bio, pronomes, status), o plugin intercepta o componente principal da tela de perfil (`UserProfileContent`/`UserProfile`) e percorre toda a árvore de elementos renderizada, marcando cada texto (`<Text>`) como selecionável. Isso cobre bio, pronomes e status de uma vez só, e tende a resistir melhor a mudanças internas que o Discord fizer no futuro. Há também um patch extra e independente específico da bio (igual ao CopyBios original), como redundância.

Se uma atualização do Discord quebrar o plugin, avise para ajustarmos os nomes/estratégia de busca.
