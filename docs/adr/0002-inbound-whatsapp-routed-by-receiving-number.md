# Inbound WhatsApp is routed by the receiving number

An inbound WhatsApp message belongs to the company that owns the receiving number (Meta's `phone_number_id`), and a receiving number belongs to exactly one company. The sender's number is never used to decide the company: the same person can be a tenant of several companies, and Meta may omit the sender's phone number entirely (business-scoped user IDs). The sender only identifies the tenant or contact within the company already chosen.
