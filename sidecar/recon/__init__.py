"""Portal cartographer: a read-only crawler that maps a tax portal's screens
(HTML, DOM inventory, accessibility tree, screenshots, XHR traffic) so later
automation can be written against real markup instead of guesses.

Output goes under data/portal-map/ (gitignored): it contains client data.
"""
