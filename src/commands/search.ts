import {
  AutocompleteChoice,
  AutocompleteContext,
  CommandContext,
  CommandOptionType,
  SlashCommand,
  SlashCreator
} from 'slash-create';

import TypeNavigator from '../util/typeNavigator';

export default class SearchCommand extends SlashCommand {
  constructor(creator: SlashCreator) {
    super(creator, {
      name: 'search',
      description: 'Search for a documentation entry.',
      options: [
        {
          name: 'query',
          description: 'The query to search all entries.',
          type: CommandOptionType.STRING,
          autocomplete: true,
          required: true
        }
      ]
    });
  }

  async autocomplete(ctx: AutocompleteContext): Promise<AutocompleteChoice[]> {
    const { query } = ctx.options as { query: string };

    const results = TypeNavigator.fuzzyFilter(query);

    return results.map((entry) => ({ name: `${entry.string} {score: ${entry.score}}`, value: entry.string }));
  }

  async run(ctx: CommandContext): Promise<void> {
    const { query } = ctx.options as { query: string };

    const [first, second = ''] = query.split(/[#$~]/);
    const subtype = TypeNavigator.typeMap.all[query];

    const command = ['/docs', subtype, `${subtype}: ${second || first}`];

    if (second) command.splice(1, 0, 'class');

    ctx.send(
      [
        `You selected \`${query}\`, this is not a entry retrieval command.`,
        '*Entries found in this command may include internal structures not included on the primary command.*',
        `> Please use \`${command.join(' ')}\` - </docs ${subtype}:${this.ids.get('global')}>.`
      ].join('\n'),
      { ephemeral: true }
    );
  }
}
