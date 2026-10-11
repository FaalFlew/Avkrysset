namespace TimePlanner.API.Models.Organization;

public static class InvitationStatus
{
    public const string Pending = "Pending";
    public const string Accepted = "Accepted";
    public const string Declined = "Declined";
    public const string Rescinded = "Rescinded"; // Withdrawn by an admin
    public const string Expired = "Expired";
}