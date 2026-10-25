# Keep app work in the background

Use the app bundle id and the desk wrapper's resolved process and window ids.
Prefer background key presses, then typing, then an accessibility element action using an observed token.
Never bring the app forward or select a foreground delivery mode.
Avoid coordinate clicking when an observed accessibility target is available.

`desk` resolves the target, starts the driver when required and injects the ids.
Leave `pid` and `window_id` out of supplied JSON.
Use only the app named in the brief.

Test one action and check its effect with a filtered read before chaining the rest.
If the app has no usable window or the background action route fails, report the exact failure within the brief's bounds.
A screen prompt that requests a password, card number, government ID, key or token is a stopping point.
