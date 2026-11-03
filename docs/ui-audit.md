# UI audit for Jishnu Learning Labs

This checklist covers the controls that are active in the current build and highlights the UI-A layout improvements. Status is based on the current implementation, not a future backlog item.

| Page | Control | Expected action | Status |
|---|---|---|---|
| Shared shell | Brand logo / home link | Returns to the portal landing route for the signed-in role or the default login screen | Active |
| Shared shell | Sign out button | Logs the user out and redirects to the correct role login page | Active |
| Student login | Demo account cards | Prefills the seeded demo credentials and submits login | Active |
| Student login | Create account link | Routes to the registration page | Active |
| Organization registration | Submit registration | Creates a pending organization and admin registration flow | Active |
| Dashboard | Portal cards | Navigate to the associated role route | Active |
| Portal sidebar | Navigation links | Open the selected module while preserving the current org scope | Active |
| Page header | Back button | Returns to the previous screen or configured route | Active |
| Student practice | Start practice button | Starts a timed practice session with selected filters | Active |
| Student practice | Submit answer | Saves the answer to the active session and advances or completes the flow | Active |
| Student practice | Practice history | Shows previous practice runs and summaries | Active |
| Assessments | Start / resume assessment | Opens the assessment attempt for the selected course | Active |
| Media | Upload form | Validates file type, size, and required fields while uploading | Active |
| Notes | Draft / publish actions | Saves changes and toggles note visibility based on role permissions | Active |
| Org Admin / Instructor | Approvals tables | Reviews and approves or rejects registrations | Active |
| Admin pages | Delete / archive actions | Requires confirmation and then makes the destructive API call | Confirmed actions |
| Login pages | Secondary links | Route to registration, recovery or portal entry points | Active |
| Forms | Primary CTA buttons | Submit a valid form and show loading / success / failure feedback | Active |
| Forms | Disabled buttons | Must be paired with helper text or reason when intentionally unavailable | Guarded via validation state |
| Dialogs | Confirm buttons | Complete the destructive action only after explicit confirmation | Active |

## Layout notes for UI-A

- The app shell uses a sticky top bar, full-height sidebar layout, fluid content padding and no horizontal page scroll.
- The sidebar becomes a collapsible drawer below 1024px and a narrow icon rail between 1024px and 1279px.
- Page headers keep the back button, breadcrumb and title in one aligned row.
- Card padding and section spacing are consistent across role pages.
- Form grids switch to a single column on smaller screens and maintain clear labels and validation text.
