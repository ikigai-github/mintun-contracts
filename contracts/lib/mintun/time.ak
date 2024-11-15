use aiken/interval.{Interval}
use aiken/time.{PosixTime}

/// If there is a container range this function checks that contained range is completely within that range.
pub fn contains(
  range: Interval<PosixTime>,
  maybe_container: Option<Interval<PosixTime>>,
) {
  when maybe_container is {
    Some(container) ->
      interval.hull(range, container) == container
    None -> True
  }
}
