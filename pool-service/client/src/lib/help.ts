/**
 * The in-app Help (beta). Every text is English and goes through the translator when shown, so
 * each one is wrapped in h() (which does nothing) for `npm run i18n:check` to find it.
 *
 * `screens`: route names whose "?" button opens this topic. `owner`: shown to owners only.
 * Keep it short and plain: people read it on a phone, between pools.
 */
export type HelpBlock = { p: string } | { steps: string[] } | { tip: string };
export interface HelpTopic {
  id: string;
  title: string;
  icon: string;
  owner?: boolean;
  screens: string[];
  body: HelpBlock[];
}

/** Marks a Help text for the translator's key list. */
const h = (text: string) => text;

export const HELP: HelpTopic[] = [
  {
    id: 'start',
    title: h('Getting started'),
    icon: 'rocket_launch',
    screens: [],
    body: [
      { p: h('The app runs in your phone’s browser and installs like any other app. Once it has loaded, it keeps working without signal.') },
      { steps: [
        h('Open the app’s address (from your invite) in Chrome on Android, or Safari on iPhone.'),
        h('Log in with your email and the password you were given.'),
        h('Choose your own password and your language.'),
        h('Android: tap the ⋮ menu, then “Install app” or “Add to Home screen”. iPhone: tap Share, then “Add to Home Screen”.'),
        h('From now on, open it from its icon.'),
      ] },
      { tip: h('Lost your password? Tap “Forgot password?” on the login screen for an email link, or ask the business owner for a new temporary one.') },
    ],
  },
  {
    id: 'route',
    title: h('The route'),
    icon: 'checklist',
    screens: ['route', 'desk-route'],
    body: [
      { p: h('The Route lists this week’s pools by service day, with today marked. A tech sees only the pools on their own route.') },
      { steps: [
        h('Tap a pool to open its visit.'),
        h('Tap Navigate to open the address in your maps app.'),
        h('A pool gets a checkmark when it’s done this week.'),
        h('Start of a new week: Route menu → Reset week clears every checkmark.'),
      ] },
      { tip: h('Owners can show everyone’s route or one tech’s at a time.') },
    ],
  },
  {
    id: 'visit',
    title: h('Doing a visit'),
    icon: 'pool',
    screens: ['visit', 'visit-detail', 'pool-visits'],
    body: [
      { p: h('A visit card holds the water readings, the tasks, the chemicals you added and a note. The previous visit’s card is below it, to compare.') },
      { steps: [
        h('Start the timer when you arrive.'),
        h('Enter the readings and tick the tasks you did.'),
        h('Add each chemical and its amount, or tap “Same as last time”.'),
        h('Stop the timer and tap Save visit.'),
      ] },
      { p: h('The timer can be paused (a break, a trip to the truck) and its times edited later. Only one timer runs at a time.') },
      { tip: h('Saved on phone means it uploads by itself when there’s signal.') },
    ],
  },
  {
    id: 'issues',
    title: h('Issues and photos'),
    icon: 'report_problem',
    screens: ['issues', 'pool-issues'],
    body: [
      { p: h('An issue is anything to fix or follow up: a leak, a noisy pump, a broken light.') },
      { steps: [
        h('Tap Add issue on a visit, or New issue on the Issues tab.'),
        h('Give it a title, details and photos (camera or gallery).'),
        h('Mark it Urgent and/or Important. Both together shows it in red.'),
        h('When it’s fixed, tap Completed. Not now? Postpone it.'),
      ] },
    ],
  },
  {
    id: 'recap',
    title: h('Sending a visit recap'),
    icon: 'send',
    screens: ['visit-recap'],
    body: [
      { p: h('A recap tells the customer what was done: date, tasks, water test and the chemicals added (names and amounts).') },
      { steps: [
        h('On a saved visit, tap Send recap.'),
        h('Write a note for the customer and tick the photos to include.'),
        h('Tap Email or Share, then Mark sent.'),
      ] },
      { tip: h('Your private visit notes and chemical costs are never included.') },
    ],
  },
  {
    id: 'offline',
    title: h('Working offline'),
    icon: 'cloud_off',
    screens: ['sync'],
    body: [
      { p: h('Everything you do is saved on the phone first, then uploaded when there’s signal. The chip at the top shows whether anything is waiting.') },
      { steps: [
        h('Tap the chip to open Sync and see what’s waiting.'),
        h('Sync now uploads straight away.'),
        h('Don’t log out while changes are waiting: they would be lost.'),
      ] },
    ],
  },
  {
    id: 'account',
    title: h('Your account and language'),
    icon: 'account_circle',
    screens: ['account'],
    body: [
      { p: h('More → My account: change your password and language, and see the devices logged in as you.') },
      { tip: h('Lost a phone? Sign out your other devices there.') },
    ],
  },
  {
    id: 'customers',
    title: h('Customers and pools'),
    icon: 'people',
    screens: ['customers', 'customer', 'customer-new', 'customer-edit', 'pool-new', 'pool-edit', 'overview', 'desk-customers'],
    body: [
      { p: h('Every field is optional: fill in what you know, add the rest later.') },
      { steps: [
        h('Customers → Add customer: name, phones, email, address, notes.'),
        h('Class: current, prospect or past. Only current customers get invoices.'),
        h('Add pool: a weekly service day or a one-time date puts it on the Route.'),
        h('On the pool, list its equipment (pump, filter, heater…) with notes and photos.'),
      ] },
    ],
  },
  {
    id: 'setup',
    title: h('Setting up your business'),
    icon: 'storefront',
    owner: true,
    screens: ['business', 'chemicals', 'desk-business', 'desk-chemicals'],
    body: [
      { steps: [
        h('More → Business details: name, logo, address, phone, email, payment instructions and invoice terms.'),
        h('Your logo also becomes the app’s icon and its login screen.'),
        h('Set the rate per mile and each customer’s distance from your base to count mileage.'),
        h('More → Chemicals: a price per unit for each. Techs, invoices and recaps never show costs.'),
        h('Team: add a login for each tech (see Team and routes).'),
      ] },
    ],
  },
  {
    id: 'team',
    title: h('Team and routes'),
    icon: 'groups',
    owner: true,
    screens: ['team', 'desk-team'],
    body: [
      { p: h('Techs see their own route, without any money. Owners see everything.') },
      { steps: [
        h('More → Team → Add a login: their name and email.'),
        h('Tap Invite to send them the app’s address, their login and the temporary password.'),
        h('Route: tick the pools they service. A pool is on one route at a time.'),
        h('Forgot password: give them a new temporary password. Left: turn their login off.'),
      ] },
    ],
  },
  {
    id: 'invoices',
    title: h('Invoices and payments'),
    icon: 'request_quote',
    owner: true,
    screens: ['invoices', 'invoice', 'desk-invoices', 'desk-payments'],
    body: [
      { p: h('Billing is a flat monthly rate per customer, chemicals included.') },
      { steps: [
        h('Invoices → Create invoices: a draft for each current customer with a monthly rate.'),
        h('Open a draft, check it, then share the PDF.'),
        h('Record each payment: check, cash, electronic or other. Part payments are fine.'),
        h('Unpaid invoices past their due date show as Overdue.'),
      ] },
    ],
  },
  {
    id: 'money',
    title: h('Money and mileage'),
    icon: 'account_balance_wallet',
    owner: true,
    screens: ['money', 'money-new', 'money-entry', 'desk-money', 'desk-mileage'],
    body: [
      { steps: [
        h('Money → add expenses, other income and the miles you drove each day.'),
        h('Tools count as capital purchases. Supplies for a customer go on their next invoice.'),
        h('“What you earn per hour” shows each customer’s profit per hour, month by month.'),
      ] },
    ],
  },
  {
    id: 'desktop',
    title: h('Desktop view and dashboard'),
    icon: 'computer',
    owner: true,
    screens: ['desk', 'desk-visits'],
    body: [
      { p: h('On a computer, More → Desktop view shows tables and a dashboard. This device remembers the choice.') },
      { steps: [
        h('Cards can be shown or hidden, resized and opened full screen.'),
        h('Your card layout is saved with your login, so it follows you to any computer.'),
        h('Every table can choose its columns and export to Excel or CSV.'),
      ] },
    ],
  },
  {
    id: 'import',
    title: h('Importing and exporting'),
    icon: 'upload_file',
    owner: true,
    screens: ['desk-import'],
    body: [
      { steps: [
        h('Desktop view → Customers → Import: choose a CSV or Excel file.'),
        h('Match its columns to the app’s fields, then check the preview.'),
        h('Customers you already have are merged; where both have a different value, you choose.'),
        h('Changed your mind? Undo the import from the same screen.'),
        h('More → Export everything: one Excel file with all your data.'),
      ] },
    ],
  },
  {
    id: 'tester',
    title: h('Beta tester guide'),
    icon: 'science',
    screens: [],
    body: [
      { p: h('Thank you for testing! Use the app for your real work and tell us what gets in your way.') },
      { steps: [
        h('Try a normal week: the route, visits with readings and chemicals, issues with photos.'),
        h('Try it with no signal, then check that everything uploads.'),
        h('Owners: set up your business, add a tech, make and send an invoice.'),
        h('Anything odd, slow or confusing: More → Send feedback, right away while you remember.'),
      ] },
      { p: h('Your data: each business has its own server space and its own database. It is backed up every night, with an encrypted copy kept off the server. Your data is yours: it is never sold or shared.') },
      { p: h('Leaving: the owner can download everything at any time (More → Export everything). When a business closes its account, a final backup is kept for 90 days and then deleted.') },
      { tip: h('During the beta, things may change from week to week. Your data stays safe through every update.') },
    ],
  },
  {
    id: 'beta',
    title: h('Beta: feedback and support'),
    icon: 'campaign',
    screens: ['feedback', 'help'],
    body: [
      { p: h('This app is in beta: it works, but it’s still being polished. Your feedback shapes what comes next.') },
      { steps: [
        h('More → Send feedback: a problem, an idea or a question.'),
        h('Say what you were doing and what you expected. The screen and app version are sent with it.'),
        h('No signal? It’s sent when you’re back online.'),
      ] },
      { tip: h('Translations are new: tell us about words that look wrong.') },
    ],
  },
];

/** The topic a screen's "?" opens. */
export function topicForScreen(routeName: unknown): string | undefined {
  return HELP.find((t) => t.screens.includes(String(routeName ?? '')))?.id;
}

export const SUPPORT_EMAIL = 'steven@evolutiondfw.com';
export const LEGAL_LINE = 'Great Pool Friend. Created by S R Donaldson, all rights reserved.';
