import { test, useSpectron } from '../../helpers/spectron';
import { logIn } from '../../helpers/spectron/user';
import { clickGoLive, prepareToGoLive, submit } from '../../helpers/spectron/streaming';
import { fillForm, selectTitle, selectGamesByTitles } from '../../helpers/form-monkey';
import { sleep } from '../../helpers/sleep';

useSpectron();

test('Multistream default mode', async t => {
  const client = t.context.app.client;
  await logIn(t, null, { multistream: true });
  await prepareToGoLive(t);
  await clickGoLive(t);

  // enable all platforms
  await fillForm(t, null, {
    twitch: true,
    facebook: true,
    youtube: true,
  });

  // wait until all platforms prepopulate data
  await sleep(2000);

  // add settings
  await fillForm(t, null, {
    title: 'Test stream',
    description: 'Test stream description',
    game: selectGamesByTitles([
      { title: 'Fortnite', platform: 'facebook' },
      { title: 'Fortnite', platform: 'twitch' },
    ]),
  });

  await submit(t);
  t.true(
    await client.isExisting('span=Configure the Multistream service'),
    'Mutlistream should be enabled',
  );
  await client.waitForVisible("h1=You're live!", 60000);
});

test('Multistream advanced mode', async t => {
  const client = t.context.app.client;
  await logIn(t, null, { multistream: true });
  await prepareToGoLive(t);
  await clickGoLive(t);

  // enable all platforms
  await fillForm(t, null, {
    twitch: true,
    facebook: true,
    youtube: true,
  });

  // wait until all platforms prepopulate data
  await sleep(2000);

  // switch advanced mode on
  await fillForm(t, null, {
    advancedMode: true,
  });

  await fillForm(t, 'form[name="twitch-settings"]', {
    customEnabled: true,
    title: 'twitch title',
    game: selectTitle('Fortnite'),
    tags: ['100%'],
  });

  await fillForm(t, 'form[name="youtube-settings"]', {
    customEnabled: true,
    title: 'youtube title',
    description: 'youtube description',
  });

  await fillForm(t, 'form[name="facebook-settings"]', {
    customEnabled: true,
    title: 'facebook title',
    game: selectTitle('Fortnite'),
  });

  await submit(t);
  t.true(
    await client.isExisting('span=Configure the Multistream service'),
    'Mutlistream should be enabled',
  );
  await client.waitForVisible("h1=You're live!", 60000);
});
