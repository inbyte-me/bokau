// How each party game is presented on the TV (the rules live in @doblaje/party).
import type { GameMode } from '@doblaje/party';
import { t } from '@doblaje/ui/i18n';

export interface GameInfo {
  mode: GameMode;
  /** the letter the TV lists it under (A–F) */
  key: string;
  title: string;
  /** one line: what makes it funny */
  pitch: string;
  /** how a turn goes: on the TV, on your phone, at the end */
  how: [string, string, string];
}

export const GAMES = (): GameInfo[] => [
  {
    mode: 'dub',
    key: 'A',
    title: t('Dub the scene'),
    pitch: t('Everyone says the real lines in their own voice.'),
    how: [
      t('Each player gets a character of the scene.'),
      t('Your phone shows your line, with an idea for a funnier one if you want it.'),
      t('The TV plays the scene with everyone’s voices.'),
    ],
  },
  {
    mode: 'badlip',
    key: 'B',
    title: t('Bad Lip Reading'),
    pitch: t('New lines written to fit the mouths on screen, about whatever you choose.'),
    how: [
      t('You choose what the scene is really about.'),
      t('Your phone shows the new line that fits the mouth movements.'),
      t('The TV plays the scene with the new lines as subtitles.'),
    ],
  },
  {
    mode: 'telenovela',
    key: 'C',
    title: t('Telenovela'),
    pitch: t('The scene’s dialogue rewritten as melodrama.'),
    how: [t('Every line is rewritten as a soap opera.'), t('Your phone shows your melodramatic line. Overact.'), t('The TV plays the drama.')],
  },
  {
    mode: 'genre',
    key: 'D',
    title: t('Genre Swap'),
    pitch: t('The dialogue rewritten as noir, pirate, corporate or 80s action.'),
    how: [t('You pick a genre.'), t('Your phone shows your line in that genre.'), t('The TV plays the scene in its new genre.')],
  },
  {
    mode: 'blind',
    key: 'E',
    title: t('Blind Dubbing'),
    pitch: t('No script: each player improvises a silent stretch, hearing only how the last one ended.'),
    how: [
      t('The scene is cut into silent stretches, one per turn.'),
      t('Your phone plays the last second of the previous player, then you improvise.'),
      t('The TV plays the whole story nobody has heard.'),
    ],
  },
  {
    mode: 'trailer',
    key: 'F',
    title: t('Trailer Director'),
    pitch: t('The room pitches a movie about the clip, directs every scene, and the result is its trailer.'),
    how: [
      t('Everyone pitches what the clip is about, and votes for the best pitch.'),
      t('You perform scenes with no script, told what happens by the others, while they direct the next one and a critic writes a quote.'),
      t('The TV plays the trailer: title cards, critics and the title the room chose.'),
    ],
  },
];
