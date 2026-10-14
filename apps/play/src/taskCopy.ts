// What a phone says for each thing it asks of the player (the rules are in @doblaje/party; the words are here).
import type { TaskView } from '@doblaje/party';
import { t } from '@doblaje/ui/i18n';

export interface TaskCopy {
  eyebrow: string;
  title: string;
  lead: string;
  /** write tasks: the hint inside the box */
  placeholder: string;
  /** after answering */
  waiting: string;
}

export function taskCopy(task: Pick<TaskView, 'kind' | 'stage' | 'logline' | 'before' | 'character'>): TaskCopy {
  const movie = task.logline ? t('The movie: {pitch}', { pitch: task.logline }) : '';
  const waiting = t('Sent. Waiting for the others.');
  if (task.stage === 'vote') {
    const title = {
      pitch: t('Which pitch is best?'),
      direction: t('Which direction is best?'),
      title: t('Which title is best?'),
      card: t('Which description is best?'),
      review: '',
    }[task.kind];
    return { eyebrow: t('Vote'), title, lead: t('Tap one. It cannot be yours.'), placeholder: '', waiting: t('Voted. Waiting for the others.') };
  }
  switch (task.kind) {
    case 'pitch':
      return {
        eyebrow: t('The movie'),
        title: t('What is this movie about?'),
        lead: t('Watch the clip and pitch it in one line. Everyone’s ideas go to a vote.'),
        placeholder: t('A bank heist, but with hamsters'),
        waiting,
      };
    case 'card':
      return {
        eyebrow: t('Create a character'),
        title: t('Who is {name}?', { name: task.character?.name ?? '' }),
        lead: t('Describe their voice and personality in a few words. Someone else may end up playing them, and nobody sees this until the cast is revealed.'),
        placeholder: t('Gruff, slow talker, suspicious of cheese'),
        waiting,
      };
    case 'direction':
      return {
        eyebrow: t('Direct the next scene'),
        title: t('What happens here?'),
        lead: [
          movie,
          task.before ? t('The scene before was about: {before}', { before: task.before }) : '',
          t('The player who records it will read your idea.'),
        ]
          .filter(Boolean)
          .join('\n'),
        placeholder: t('They open the vault and find cheese'),
        waiting,
      };
    case 'title':
      return { eyebrow: t('The last scene is being recorded'), title: t('Title the movie'), lead: movie, placeholder: t('Cheddar Hard'), waiting };
    case 'review':
      return {
        eyebrow: t('You are the critic'),
        title: t('What will the papers say?'),
        lead: [movie, t('You have not seen it. Write a quote for the trailer.')].filter(Boolean).join('\n'),
        placeholder: t('A triumph of the human spirit'),
        waiting,
      };
  }
}
