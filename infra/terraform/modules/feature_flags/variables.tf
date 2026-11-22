variable "environment" { type = string }
variable "initial_flags" {
  type = map(bool)
  validation {
    condition     = alltrue([for k in keys(var.initial_flags) : contains(["ENABLE_DYNAMIC_SURGE_PRICING", "ENABLE_FAST_CHARGE_BOOST", "SIMULATE_CHARGER_HARDWARE_FAULT"], k)])
    error_message = "Flag desconocida."
  }
}
variable "point_in_time_recovery" {
  type    = bool
  default = false
}
