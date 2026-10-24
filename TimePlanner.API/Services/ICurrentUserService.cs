namespace TimePlanner.API.Services;

public interface ICurrentUserService
{
    Guid? UserId { get; }
}