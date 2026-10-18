# The Property Manager forwards Reimbursement Requests

A Tenant who arranges an Urgent Repair claims the cost back from the Property Owner. myEST8 used to forward the receipt to the Owner the moment the Tenant uploaded it. That sent unchecked files (a photo of the wrong thing, a receipt over the $1,000 limit, no amount at all) straight to the Owner under the Agency's name, and the Agency had no record of whether the Tenant was ever paid.

Now a receipt puts the Reimbursement Request in "Awaiting your review". The Property Manager checks the receipt and the amount on `/reimbursements/:id`, then forwards it (the Owner gets the files and the amount by email, the Property Manager copied), and marks it Reimbursed once the Owner has paid, which tells the Tenant. The Tenant must upload a photo or PDF; an amount over $1,000 is allowed with a warning, since the Owner may still choose to pay it.

Events go in their own `urgent_repair_events` table because the Ticket timeline needs a Ticket, and an Urgent Repair never becomes one.
