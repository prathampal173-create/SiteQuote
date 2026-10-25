# Product rules

SiteQuote supports one owner per account, residential construction projects and USD pricing. CRM reads and writes require a connection; already scheduled device alerts may fire offline.

## Leads and projects

A lead requires a customer name and at least one phone number or email address. Sources are Referral, Google, Phone, Email and Other. Contact stages are New, Contacted and Site Visit Completed; owners can correct them manually. Search matches customer names, and the Quote Sent lead filter selects leads with a project currently in that state.

Each lead can have independent named projects with their own address, notes, tasks, photos and quotes. Project states are Draft, Quote Sent, Won and Lost; leads have no Won/Lost state. Tasks have a title, optional notes, nonnegative cost and one of seven categories: House Remodeling, Kitchen Remodeling, Bathroom Remodeling, Flooring, Painting, Electrical/Plumbing or Miscellaneous. Categories may repeat.

Won requires selecting a Sent quote from that Quote Sent project. Lost is allowed from Draft or Quote Sent. Reopening Won/Lost clears the active approval, retains decision history, and returns to Quote Sent if a Sent version exists, otherwise Draft.

Until reopened, Won/Lost locks project title/address/tax, task fields and creation/removal, and additional charges. Internal project notes, photos, reminders and shared contact/business details remain editable.

## Estimates and quotes

Prices use integer USD cents and tax rates use basis points, from 0% to 30%. Tax rounds half up once on the combined task and additional-charge subtotal. The acceptance example is $3,000 tasks + $150 charges + $252 tax at 8% = **$3,402**.

1. Preview reads saved estimate data without creating a quote or changing status.
2. Prepare requires a saved business name, at least one task, a positive total and an open project. Changed preview inputs require another preview.
3. Preparation reuses the highest-numbered matching Sent version first, then the highest-numbered matching Prepared version, otherwise creates the next number. Reuse retains the original issue date.
4. Share opens the native PDF share sheet. Returning or cancelling leaves the quote unchanged.
5. Explicit Mark sent changes Prepared to Sent and the project to Quote Sent. Repeating confirmation is idempotent and preserves subsequent Won/Lost decisions.
6. A newly confirmed send can offer a follow-up three local calendar days later; no reminder is created until the owner saves the form.

Numbered snapshots cannot be edited or deleted. PDFs contain frozen business/customer contact, project/site details, task category/title/notes/prices, charges and totals; internal lead/project notes and photos are excluded. Won project cards use the selected accepted quote's amount; other cards use the highest-numbered Sent version, regardless of send time.

## Photos

Camera/gallery images are labeled Site visit or Client-provided and belong to a project or a task within it. Processing produces JPEGs with a maximum 2048-pixel edge and 10 MiB size. Galleries distinguish direct project photos from task photos and provide private full-size viewing.

Failed uploads retain a local retry entry. Removing a saved photo requires confirmation; interrupted deletions remain repairable. Repair retains untracked files that might belong to another device's pending upload. Removing a task cleans up its saved photos before deleting the task.

## Reminders and Dashboard

Reminders require a lead, type, title and future due time; an optional project must belong to that lead. Types are Site visit, Follow-up and Other. Open reminders group by elapsed due instant and the device's current date into Overdue, Today and Upcoming. Completed reminders sort newest first; their detail screen permits editing, reopening and confirmed deletion. Deletion also removes that reminder's completion history.

A genuine Site visit completion atomically advances a New/Contacted lead to Site Visit Completed. Reopening does not reverse the stage, and retrying an already completed reminder does not override a later manual correction.

Device alerts are optional, generic and best effort. Arrival, dismissal and tapping never complete a reminder. Saved status remains authoritative if permission or scheduling fails.

Dashboard shows Total Leads, Quote Sent Projects, Won Projects and Overdue Reminders, with links to the corresponding filtered lists. Failed counts display unavailable rather than zero.

## Boundaries

Users cannot delete leads, projects or numbered quotes. There are no team roles, client portal, invoices/payments, password-reset UI, automatic customer messaging, recurring reminders, remote push, multiple currencies or offline CRM edits.
