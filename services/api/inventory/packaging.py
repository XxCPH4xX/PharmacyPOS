from core.errors import BusinessError
from inventory.models import PackageMovement


def available_packages(batch, product, level):
    if level == "outer":
        return batch.outer_quantity
    inners = batch.inner_quantity
    if product.allow_break_outer and product.inner_name:
        inners += batch.outer_quantity * (batch.outer_size // batch.inner_size)
    if level == "inner":
        return inners
    loose = batch.loose_quantity
    if product.allow_break_inner:
        loose += inners * batch.inner_size
    if not product.inner_name and product.allow_break_outer:
        loose += batch.outer_quantity * batch.outer_size
    return loose


def consume_packages(batch, product, level, quantity):
    """Open only a permitted parent; never rebuild a sealed pack from loose stock."""
    if quantity > available_packages(batch, product, level):
        raise BusinessError("Insufficient physical packages.", "insufficient_stock")
    if level == "outer":
        batch.outer_quantity -= quantity
        base = quantity * batch.outer_size
    elif level == "inner":
        missing = max(0, quantity - batch.inner_quantity)
        if missing:
            per_outer = batch.outer_size // batch.inner_size
            opened = (missing + per_outer - 1) // per_outer
            batch.outer_quantity -= opened
            batch.inner_quantity += opened * per_outer
        batch.inner_quantity -= quantity
        base = quantity * batch.inner_size
    else:
        missing = max(0, quantity - batch.loose_quantity)
        if missing and product.inner_name:
            needed = (missing + batch.inner_size - 1) // batch.inner_size
            missing_inners = max(0, needed - batch.inner_quantity)
            if missing_inners:
                per_outer = batch.outer_size // batch.inner_size
                opened = (missing_inners + per_outer - 1) // per_outer
                batch.outer_quantity -= opened
                batch.inner_quantity += opened * per_outer
            batch.inner_quantity -= needed
            batch.loose_quantity += needed * batch.inner_size
        elif missing:
            opened = (missing + batch.outer_size - 1) // batch.outer_size
            batch.outer_quantity -= opened
            batch.loose_quantity += opened * batch.outer_size
        batch.loose_quantity -= quantity
        base = quantity
    batch.quantity -= base
    return base


def physical_counts(batch):
    return (batch.loose_quantity, batch.inner_quantity, batch.outer_quantity)


def record_packages(scope, batch, before, kind, source_id):
    after = physical_counts(batch)
    PackageMovement.objects.create(
        tenant=scope.tenant,
        branch=scope.branch,
        batch=batch,
        loose_delta=after[0] - before[0],
        inner_delta=after[1] - before[1],
        outer_delta=after[2] - before[2],
        kind=kind,
        source_id=source_id,
    )
